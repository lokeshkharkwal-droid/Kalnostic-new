import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AuthRole,
  Person,
  Prisma,
  StaffStatus,
  TenantStaffMembership,
  UserBranchProfile,
  UserType,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../security/password.service';
import { UsernameGeneratorService } from '../security/username-generator.service';
import { EncryptionService } from '../security/encryption.service';
import { BranchService } from '../branch/branch.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import {
  PROFILE_BRANCH_MATRIX,
  PROFILE_LABELS,
  ProfileKey,
} from '../permissions/constants/profile-registry.constant';
import { AuthRoleService } from '../auth-role/auth-role.service';
import {
  MODULE_PERMISSION_CATALOG,
  roleBaselinePermissions,
  roleTemplateModules,
} from '../permissions/constants/module-permissions.constant';
import {
  isValidModuleKey,
  moduleLabel,
  SYSTEM_MODULES,
} from '../permissions/constants/system-modules.constant';
import { BranchAssignmentItemDto, CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateBranchAssignmentDto } from './dto/update-branch-assignment.dto';
import { UpdateBranchPermissionsDto } from './dto/update-branch-permissions.dto';
import { ListUsersQueryDto, UserSortField } from './dto/list-users-query.dto';
import { ListRegisteredUsersQueryDto } from './dto/list-registered-users-query.dto';
import {
  InvalidModuleKeyException,
  ModuleNotEnabledForBranchException,
  ModuleNotInRoleTemplateException,
  MultipleDefaultBranchException,
  NotOwnerTenantException,
  PersonEmailTakenException,
  PersonNotFoundException,
  PersonPhoneTakenException,
  ProfileInvalidForBranchException,
  ProfileNotFoundException,
  StaffMembershipNotFoundException,
  UnderageUserException,
  UsernameTakenException,
} from './exceptions/users.exceptions';

/** Minimum age (in whole years) for a staff user (v2.0). */
const MIN_USER_AGE = 18;

/** A validated, normalised branch assignment (internal to UsersService). */
interface PreparedAssignment {
  branchId: string;
  authRoleId: string;
  /** Resolved role key — kept for module-template checks and error messages. */
  roleKey: string;
  isDefault: boolean;
  defaultModuleId: string | null;
  branchStatus: StaffStatus;
}

/** Eager-load the assigned role, so its stable `key`/`name` are available. */
const PROFILE_WITH_ROLE = {
  authRole: true,
} satisfies Prisma.UserBranchProfileInclude;

/** A branch profile with its role relation loaded. */
type UserBranchProfileWithRole = UserBranchProfile & {
  authRole: AuthRole | null;
};

/** A staff membership with its (optional) primary-role relation loaded. */
type MembershipWithRole = TenantStaffMembership & { authRole: AuthRole | null };

/** One assigned branch (with its role + module) on a user-list row. */
export interface UserListBranch {
  branchId: string | null;
  branchName: string | null;
  roleKey: string;
  roleLabel: string;
  branchStatus: StaffStatus;
  isDefault: boolean;
  moduleId: string | null;
  moduleLabel: string | null;
}

/** A row in the v2.0 User List (one per staff member). */
export interface UserListRow {
  id: string;
  userCode: string;
  employeeName: string;
  username: string | null;
  email: string | null;
  mobile: string | null;
  role: string;
  roleLabel: string;
  /** Branch names only (kept for back-compat); see `branches` for full detail. */
  assignedBranches: string[];
  /** Every active assignment with its role, module, status and default flag. */
  branches: UserListBranch[];
  defaultBranch: string | null;
  defaultModule: string | null;
  status: StaffStatus;
}

/** A row in the Permissions screen (one per user + branch; status always Active). */
export interface ProfilePermissionRow {
  id: string; // userBranchProfile id
  userCode: string;
  username: string | null;
  role: string;
  roleLabel: string;
  branch: string;
  status: StaffStatus;
}

/** A module-grouped permission with its resolved grant for a (user + branch). */
export interface ResolvedBranchPermission {
  moduleKey: string;
  moduleLabel: string;
  permissionKey: string;
  label: string;
  baseline: boolean;
  allowed: boolean; // effective value (override ?? baseline)
}

/** A module with its allowed permission keys (grouped output). */
export interface PermissionModuleGroup {
  moduleKey: string;
  moduleLabel: string;
  moduleAllowed: boolean; // true if any permission in this module is allowed
  permissions: string[]; // allowed permission keys only
}

/** The role driving a user's permissions at a branch. */
export interface ResolvedRole {
  key: string;
  label: string;
}

/** A module enabled for a branch (id + display label). */
export interface BranchModuleSummary {
  moduleKey: string;
  label: string;
}

/** The module-grouped permission output (no per-request context). */
export interface GroupedPermissions {
  modules: PermissionModuleGroup[];
  allowed: string[];
}

/**
 * The current user's effective permissions at a branch: the role driving them,
 * the modules enabled for that branch, the module-grouped grid, and a flat list
 * of granted permission keys (the frontend keys off `allowed` for show/hide).
 */
export interface MyPermissions extends GroupedPermissions {
  /** The role driving permissions at the branch; null when the user is unassigned. */
  role: ResolvedRole | null;
  /** The modules enabled for the branch. */
  branchModules: BranchModuleSummary[];
}

// ── SiteAdmin: Registered Users (cross-portal, platform-level) ────────────────

/** Person kind on the SiteAdmin Registered Users surface. */
export type RegisteredUserType = 'STAFF' | 'PATIENT';

/** A row in the SiteAdmin Registered Users list (one per person). */
export interface RegisteredUserRow {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  userType: RegisteredUserType;
  status: 'ACTIVE' | 'INACTIVE';
}

/** One branch assignment on a registered-user's business membership. */
export interface RegisteredUserMembershipBranch {
  branchId: string | null;
  branchName: string | null;
  roleKey: string;
  roleLabel: string;
  branchStatus: StaffStatus;
  isDefault: boolean;
  moduleLabel: string | null;
}

/** A person's staff membership at one business (for the read-only detail). */
export interface RegisteredUserMembership {
  tenantId: string;
  tenantName: string;
  userCode: string;
  userType: UserType;
  status: StaffStatus;
  roleKey: string | null;
  roleLabel: string | null;
  branches: RegisteredUserMembershipBranch[];
}

/** Full SiteAdmin detail for one registered person (read-only). */
export interface RegisteredUserDetail {
  person: Omit<Person, 'aadhaarNumber'> & { aadhaarMasked: string | null };
  username: string | null;
  loginPhone: string | null;
  loginEmail: string | null;
  userType: RegisteredUserType;
  status: 'ACTIVE' | 'INACTIVE';
  /** Staff memberships across businesses; empty for a pure patient. */
  memberships: RegisteredUserMembership[];
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly usernameService: UsernameGeneratorService,
    private readonly encryptionService: EncryptionService,
    private readonly branchService: BranchService,
    private readonly authRoleService: AuthRoleService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  /**
   * The stable role key/label for a loaded profile — from the role relation, with
   * a fallback to the (deprecated, transition-only) `profileKey` column.
   */
  private roleView(
    role: AuthRole | null,
    fallbackKey?: string | null,
  ): { key: string; label: string } {
    const key = role?.key ?? fallbackKey ?? '';
    const label =
      role?.name ?? (key ? (PROFILE_LABELS[key as ProfileKey] ?? key) : '');
    return { key, label };
  }

  /**
   * Whether a role is tenant-level (cannot be pinned to a branch). System roles
   * use PROFILE_BRANCH_MATRIX (code); custom roles use their `allowedBranchTypes`.
   */
  private isTenantLevelRole(role: AuthRole): boolean {
    return role.isSystem
      ? (PROFILE_BRANCH_MATRIX[role.key as ProfileKey] ?? []).length === 0
      : role.allowedBranchTypes.length === 0;
  }

  /**
   * Fetch a person by id (platform-level lookup, no tenant scope).
   * @throws PersonNotFoundException if missing
   */
  async findById(personId: string): Promise<Person> {
    const person = await this.prisma.person.findFirst({
      where: { id: personId, deletedAt: null },
    });
    if (!person) {
      throw new PersonNotFoundException(personId);
    }
    return person;
  }

  /**
   * Whether a person is an active staff member of a tenant — i.e. holds at least one
   * active branch/tenant-level profile (`user_branch_profiles`) in that tenant and is
   * an active, non-deleted person. Used by other modules to validate an employee link.
   * @param personId the person to check
   * @param tenantId the tenant the person must belong to as staff
   * @returns true when the person is active staff of the tenant
   */
  async isActiveStaffOfTenant(
    personId: string,
    tenantId: string,
  ): Promise<boolean> {
    // No Prisma relation exists between UserBranchProfile and Person, so check both
    // independently: the person must be active staff, and hold an active profile in
    // the tenant.
    const [person, profile] = await Promise.all([
      this.prisma.person.findFirst({
        where: {
          id: personId,
          isStaff: true,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      }),
      this.prisma.userBranchProfile.findFirst({
        where: { personId, tenantId, isActive: true, deletedAt: null },
        select: { id: true },
      }),
    ]);
    return person !== null && profile !== null;
  }

  /**
   * All active profile assignments for a person, each with its role relation
   * loaded (used to build the JWT — `authRole.key`/`.name` feed `profile_key`/
   * `profile_label`).
   */
  async getPersonProfiles(
    personId: string,
  ): Promise<UserBranchProfileWithRole[]> {
    return this.prisma.userBranchProfile.findMany({
      where: { personId, isActive: true, deletedAt: null },
      include: PROFILE_WITH_ROLE,
    });
  }

  // ── User Management v2.0 ────────────────────────────────────────────────────

  /**
   * Create a staff user (v2.0). Identity → Person, credentials →
   * PersonCredentials (username + chosen password), employment →
   * TenantStaffMembership (sequential `userCode`, type, optional primary role,
   * global status). The authoritative role is assigned **per branch** on
   * UserBranchProfile; a user may be created with no role and assigned to
   * branches later. Aadhaar is encrypted at rest.
   * @returns the person, membership, generated user code, and login identifier
   */
  async createUser(
    tenantId: string,
    dto: CreateUserDto,
    createdBy: string,
  ): Promise<{
    person: Person;
    membership: TenantStaffMembership & { roleKey: string | null };
    userCode: string;
    loginIdentifier: string;
  }> {
    this.assertAdult(dto.dateOfBirth);
    // Resolve the optional primary role to a role row (throws if unknown).
    const primaryRole = dto.roleKey
      ? await this.authRoleService.resolveByKey(tenantId, dto.roleKey)
      : null;
    await this.assertContactUnique(dto.mobileNumber, dto.email);
    await this.assertUsernameUnique(dto.username);

    const prepared = await this.prepareBranchAssignments(
      tenantId,
      dto.roleKey ?? null,
      dto.branches ?? [],
    );

    const passwordHash = await this.passwordService.hash(dto.password);
    const aadhaarEnc = dto.aadhaarNumber
      ? this.encryptionService.encrypt(dto.aadhaarNumber)
      : null;
    const platformMrn = this.generatePlatformMrn();
    const status = dto.status ?? StaffStatus.ACTIVE;
    const isTenantLevelRole = primaryRole
      ? this.isTenantLevelRole(primaryRole)
      : false;

    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: { staffCounter: { increment: 1 } },
        select: { staffCounter: true },
      });
      const userCode = `USR-${String(tenant.staffCounter).padStart(5, '0')}`;

      const person = await tx.person.create({
        data: {
          platformMrn,
          firstName: dto.employeeName,
          lastName: null,
          dateOfBirth: new Date(dto.dateOfBirth),
          gender: dto.gender,
          bloodGroup: dto.bloodGroup ?? null,
          phone: dto.mobileNumber,
          email: dto.email,
          address: (dto.address ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          nationality: dto.nationality ?? 'Indian',
          fatherName: dto.fatherName ?? null,
          motherName: dto.motherName ?? null,
          aadhaarNumber: aadhaarEnc,
          panNumber: dto.panNumber ?? null,
          emergencyContactName: dto.emergencyContactName ?? null,
          emergencyContactNumber: dto.emergencyContactNumber ?? null,
          ownerTenantId: tenantId,
          isPatient: false,
          isStaff: true,
          isActive: true,
        },
      });

      await tx.personCredentials.create({
        data: {
          personId: person.id,
          phone: dto.mobileNumber,
          email: dto.email,
          systemUsername: dto.username,
          isSystemGeneratedUsername: false,
          passwordHash,
          isTempPassword: false,
        },
      });

      const membership = await tx.tenantStaffMembership.create({
        data: {
          tenantId,
          personId: person.id,
          userCode,
          userType: dto.userType,
          authRoleId: primaryRole?.id ?? null,
          status,
        },
      });

      if (prepared.length > 0) {
        for (const a of prepared) {
          await tx.userBranchProfile.create({
            data: {
              tenantId,
              personId: person.id,
              branchId: a.branchId,
              authRoleId: a.authRoleId,
              branchStatus: a.branchStatus,
              defaultModuleId: a.defaultModuleId,
              isDefault: a.isDefault,
              isActive: true,
              assignedAt: new Date(),
              assignedBy: createdBy,
            },
          });
        }
      } else if (isTenantLevelRole && primaryRole) {
        // Tenant-level role with no branch list: create the tenant-level profile
        // so the auth/JWT path has a profile to land on.
        await tx.userBranchProfile.create({
          data: {
            tenantId,
            personId: person.id,
            branchId: null,
            authRoleId: primaryRole.id,
            isDefault: true,
            isActive: true,
            assignedAt: new Date(),
            assignedBy: createdBy,
          },
        });
      }

      return { person, membership, userCode };
    });

    await this.eventEmitter.emitAsync('users.user.created', {
      personId: result.person.id,
      tenantId,
      userCode: result.userCode,
      createdBy,
    });
    return {
      person: result.person,
      membership: {
        ...result.membership,
        roleKey: primaryRole?.key ?? null,
      },
      userCode: result.userCode,
      loginIdentifier: dto.mobileNumber,
    };
  }

  /**
   * Edit a staff user (v2.0). Updates identity, password, optional primary role
   * and global status. `username`/`email`/`userCode` are immutable (absent from
   * the DTO). The primary `roleKey` is informational — it is **not** propagated to
   * branch assignments (per-branch roles are managed via Assign/Update Branch).
   */
  async updateUser(
    personId: string,
    tenantId: string,
    dto: UpdateUserDto,
    updatedBy: string,
  ): Promise<{
    person: Person;
    membership: TenantStaffMembership & { roleKey: string | null };
  }> {
    const person = await this.findById(personId);
    this.assertCanEdit(person, tenantId, updatedBy);
    const membership = await this.getMembership(tenantId, personId);

    if (dto.dateOfBirth !== undefined) {
      this.assertAdult(dto.dateOfBirth);
    }
    if (dto.mobileNumber && dto.mobileNumber !== person.phone) {
      await this.assertPhoneUnique(dto.mobileNumber, personId);
    }
    // Resolve the optional new primary role (throws if unknown).
    const newPrimaryRole =
      dto.roleKey !== undefined
        ? await this.authRoleService.resolveByKey(tenantId, dto.roleKey)
        : null;

    const data: Prisma.PersonUpdateInput = {};
    if (dto.employeeName !== undefined) data.firstName = dto.employeeName;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = new Date(dto.dateOfBirth);
    }
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.bloodGroup !== undefined) data.bloodGroup = dto.bloodGroup ?? null;
    if (dto.nationality !== undefined) data.nationality = dto.nationality;
    if (dto.fatherName !== undefined) data.fatherName = dto.fatherName ?? null;
    if (dto.motherName !== undefined) data.motherName = dto.motherName ?? null;
    if (dto.aadhaarNumber !== undefined) {
      data.aadhaarNumber = dto.aadhaarNumber
        ? this.encryptionService.encrypt(dto.aadhaarNumber)
        : null;
    }
    if (dto.panNumber !== undefined) data.panNumber = dto.panNumber ?? null;
    if (dto.address !== undefined) {
      data.address = dto.address ?? Prisma.JsonNull;
    }
    if (dto.mobileNumber !== undefined) data.phone = dto.mobileNumber;
    if (dto.emergencyContactName !== undefined) {
      data.emergencyContactName = dto.emergencyContactName ?? null;
    }
    if (dto.emergencyContactNumber !== undefined) {
      data.emergencyContactNumber = dto.emergencyContactNumber ?? null;
    }

    const passwordHash = dto.password
      ? await this.passwordService.hash(dto.password)
      : null;

    const updated = await this.prisma.withTenant(tenantId, async (tx) => {
      const updatedPerson = await tx.person.update({
        where: { id: personId },
        data,
      });
      if (passwordHash) {
        await tx.personCredentials.update({
          where: { personId },
          data: { passwordHash, isTempPassword: false },
        });
      }
      const membershipData: Prisma.TenantStaffMembershipUpdateInput = {};
      if (dto.userType !== undefined) membershipData.userType = dto.userType;
      if (dto.status !== undefined) membershipData.status = dto.status;
      // Primary role is informational only — never propagated to branch profiles.
      if (newPrimaryRole) {
        membershipData.authRole = { connect: { id: newPrimaryRole.id } };
      }
      const updatedMembership = await tx.tenantStaffMembership.update({
        where: { id: membership.id },
        data: membershipData,
      });
      return { person: updatedPerson, membership: updatedMembership };
    });

    await this.eventEmitter.emitAsync('users.user.updated', {
      personId,
      tenantId,
      updatedBy,
      changes: Object.keys(dto),
    });
    const roleKey = newPrimaryRole?.key ?? membership.authRole?.key ?? null;
    return {
      person: updated.person,
      membership: { ...updated.membership, roleKey },
    };
  }

  /**
   * Store an uploaded profile photo (JPG/JPEG/PNG, ≤ configured max). Writes the
   * file under UPLOAD_DIR and records the path on `Person.photoUrl`.
   * @returns the stored photo path
   */
  async uploadProfilePhoto(
    personId: string,
    tenantId: string,
    file: Express.Multer.File,
    actorId: string,
  ): Promise<{ photoUrl: string }> {
    const person = await this.findById(personId);
    this.assertCanEdit(person, tenantId, actorId);

    const dir = this.config.get<string>('UPLOAD_DIR', './uploads');
    await mkdir(dir, { recursive: true });
    const ext = extname(file.originalname) || '.jpg';
    const fileName = `${personId}-${randomBytes(6).toString('hex')}${ext}`;
    const fullPath = join(dir, fileName);
    await writeFile(fullPath, file.buffer);

    const photoUrl = `${dir.replace(/\\/g, '/')}/${fileName}`.replace(
      /^\.\//,
      '/',
    );
    await this.prisma.person.update({
      where: { id: personId },
      data: { photoUrl },
    });
    return { photoUrl };
  }

  /**
   * List staff users for a tenant (v2.0): paginated, filterable (search, branch,
   * role, module) and sortable on the spec's columns.
   */
  async listUsers(
    tenantId: string,
    query: ListUsersQueryDto,
  ): Promise<PaginatedResult<UserListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const memberships = await this.prisma.tenantStaffMembership.findMany({
      where: { tenantId, deletedAt: null },
      include: { authRole: true },
      orderBy: { createdAt: 'asc' },
    });
    if (memberships.length === 0) {
      return { data: [], total: 0, page, limit };
    }

    const personIds = memberships.map((m) => m.personId);
    const [persons, credentials, profiles] = await Promise.all([
      this.prisma.person.findMany({ where: { id: { in: personIds } } }),
      this.prisma.personCredentials.findMany({
        where: { personId: { in: personIds } },
      }),
      this.prisma.userBranchProfile.findMany({
        where: {
          tenantId,
          personId: { in: personIds },
          isActive: true,
          deletedAt: null,
        },
        include: PROFILE_WITH_ROLE,
      }),
    ]);
    const branchIds = [
      ...new Set(
        profiles.map((p) => p.branchId).filter((b): b is string => !!b),
      ),
    ];
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: branchIds }, tenantId },
    });

    const personMap = new Map(persons.map((p) => [p.id, p]));
    const credMap = new Map(credentials.map((c) => [c.personId, c]));
    const branchNameMap = new Map(branches.map((b) => [b.id, b.name]));
    const profilesByPerson = new Map<string, UserBranchProfileWithRole[]>();
    for (const p of profiles) {
      const list = profilesByPerson.get(p.personId) ?? [];
      list.push(p);
      profilesByPerson.set(p.personId, list);
    }

    let rows: UserListRow[] = memberships.map((m) => {
      const person = personMap.get(m.personId);
      const cred = credMap.get(m.personId);
      const mProfiles = profilesByPerson.get(m.personId) ?? [];
      const branchProfiles = mProfiles.filter((p) => p.branchId);
      const defaultProfile =
        mProfiles.find((p) => p.isDefault) ?? mProfiles[0] ?? null;
      const defaultBranchName =
        defaultProfile?.branchId != null
          ? (branchNameMap.get(defaultProfile.branchId) ?? null)
          : null;
      // Role now lives per-branch; show the membership's optional primary role
      // (else the default profile's role) as the row's primary role.
      const primary = this.roleView(
        m.authRole ?? defaultProfile?.authRole ?? null,
      );
      return {
        id: m.personId,
        userCode: m.userCode,
        employeeName: person?.firstName ?? '',
        username: cred?.systemUsername ?? null,
        email: person?.email ?? null,
        mobile: person?.phone ?? null,
        role: primary.key,
        roleLabel: primary.label,
        assignedBranches: branchProfiles
          .map((p) => (p.branchId ? branchNameMap.get(p.branchId) : null))
          .filter((n): n is string => !!n),
        branches: mProfiles.map((p) => {
          const rv = this.roleView(p.authRole);
          return {
            branchId: p.branchId,
            branchName: p.branchId
              ? (branchNameMap.get(p.branchId) ?? null)
              : null,
            roleKey: rv.key,
            roleLabel: rv.label,
            branchStatus: p.branchStatus,
            isDefault: p.isDefault,
            moduleId: p.defaultModuleId,
            moduleLabel: p.defaultModuleId
              ? moduleLabel(p.defaultModuleId)
              : null,
          };
        }),
        defaultBranch: defaultBranchName,
        defaultModule: defaultProfile?.defaultModuleId
          ? moduleLabel(defaultProfile.defaultModuleId)
          : null,
        status: m.status,
      };
    });

    rows = this.applyUserListFilters(rows, query, profilesByPerson);
    rows = this.sortUserRows(rows, query.sortBy, query.sortOrder);

    const total = rows.length;
    const data = rows.slice((page - 1) * limit, (page - 1) * limit + limit);
    return { data, total, page, limit };
  }

  /**
   * Full detail for one staff user: person identity (Aadhaar masked), the tenant
   * membership, and all active branch assignments with role/branch/module labels.
   */
  async getUser(
    tenantId: string,
    personId: string,
  ): Promise<{
    person: Omit<Person, 'aadhaarNumber'> & { aadhaarMasked: string | null };
    membership: TenantStaffMembership & { roleKey: string | null };
    username: string | null;
    branches: Array<{
      id: string;
      branchId: string | null;
      branchName: string | null;
      roleKey: string;
      roleLabel: string;
      branchStatus: StaffStatus;
      isDefault: boolean;
      moduleId: string | null;
      moduleLabel: string | null;
    }>;
  }> {
    const person = await this.findById(personId);
    const membership = await this.getMembership(tenantId, personId);
    const cred = await this.prisma.personCredentials.findUnique({
      where: { personId },
    });
    const profiles = await this.prisma.userBranchProfile.findMany({
      where: { tenantId, personId, isActive: true, deletedAt: null },
      include: PROFILE_WITH_ROLE,
    });
    const branchIds = profiles
      .map((p) => p.branchId)
      .filter((b): b is string => !!b);
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: branchIds }, tenantId },
    });
    const branchNameMap = new Map(branches.map((b) => [b.id, b.name]));

    const { aadhaarNumber, ...rest } = person;
    return {
      person: {
        ...rest,
        aadhaarMasked: this.maskAadhaar(aadhaarNumber),
      },
      membership: this.membershipResponse(membership),
      username: cred?.systemUsername ?? null,
      branches: profiles.map((p) => {
        const rv = this.roleView(p.authRole);
        return {
          id: p.id,
          branchId: p.branchId,
          branchName: p.branchId
            ? (branchNameMap.get(p.branchId) ?? null)
            : null,
          roleKey: rv.key,
          roleLabel: rv.label,
          branchStatus: p.branchStatus,
          isDefault: p.isDefault,
          moduleId: p.defaultModuleId,
          moduleLabel: p.defaultModuleId
            ? moduleLabel(p.defaultModuleId)
            : null,
        };
      }),
    };
  }

  /**
   * Assign (or update) the user's branch assignments in bulk. Each item carries
   * its own role (`roleKey`) and optional `moduleId`: `{ branchId, roleKey,
   * moduleId? }`. One role per branch — an existing assignment for a branch is
   * re-roled in place. Enforces a single default branch.
   */
  async assignBranches(
    tenantId: string,
    personId: string,
    branches: BranchAssignmentItemDto[],
    actorId: string,
  ): Promise<void> {
    const membership = await this.getMembership(tenantId, personId);
    const prepared = await this.prepareBranchAssignments(
      tenantId,
      membership.authRole?.key ?? null,
      branches,
    );

    await this.prisma.withTenant(tenantId, async (tx) => {
      if (prepared.some((a) => a.isDefault)) {
        await tx.userBranchProfile.updateMany({
          where: { tenantId, personId, isDefault: true },
          data: { isDefault: false },
        });
      }
      for (const a of prepared) {
        // One role per branch: match on (tenant, person, branch), not role.
        const existing = await tx.userBranchProfile.findFirst({
          where: { tenantId, personId, branchId: a.branchId, deletedAt: null },
        });
        if (existing) {
          await tx.userBranchProfile.update({
            where: { id: existing.id },
            data: {
              authRoleId: a.authRoleId,
              isActive: true,
              branchStatus: a.branchStatus,
              defaultModuleId: a.defaultModuleId,
              isDefault: a.isDefault,
              revokedAt: null,
              revokedBy: null,
            },
          });
        } else {
          await tx.userBranchProfile.create({
            data: {
              tenantId,
              personId,
              branchId: a.branchId,
              authRoleId: a.authRoleId,
              branchStatus: a.branchStatus,
              defaultModuleId: a.defaultModuleId,
              isDefault: a.isDefault,
              isActive: true,
              assignedAt: new Date(),
              assignedBy: actorId,
            },
          });
        }
      }
      await tx.person.update({
        where: { id: personId },
        data: { isStaff: true },
      });
    });
  }

  /**
   * Patch a single (user + branch) assignment: per-branch role, status, default
   * flag, and module. Validates the role for the branch type and the module is
   * enabled for the branch (and linked to the role template, when it links any).
   */
  async updateBranchAssignment(
    tenantId: string,
    personId: string,
    branchId: string,
    dto: UpdateBranchAssignmentDto,
    actorId: string,
  ): Promise<UserBranchProfile> {
    await this.getMembership(tenantId, personId);
    const existing = await this.prisma.userBranchProfile.findFirst({
      where: { tenantId, personId, branchId, isActive: true, deletedAt: null },
      include: PROFILE_WITH_ROLE,
    });
    if (!existing) {
      throw new ProfileNotFoundException(personId, branchId);
    }

    await this.branchService.findById(branchId, tenantId);
    // Resolve the new role if one is supplied (throws if unknown); else keep the
    // existing one. Branch-type restriction is lifted (any branch-level role may
    // be assigned to any branch type); tenant-level roles still can't be pinned.
    const newRole = dto.roleKey
      ? await this.authRoleService.resolveByKey(tenantId, dto.roleKey)
      : null;
    if (newRole && this.isTenantLevelRole(newRole)) {
      throw new ProfileInvalidForBranchException(
        newRole.key,
        'none — this is a tenant-level role and cannot be assigned to a branch',
      );
    }
    const targetRoleKey = newRole?.key ?? existing.authRole?.key ?? '';
    if (dto.moduleId !== undefined && dto.moduleId !== null) {
      await this.assertModuleEnabledForBranch(tenantId, branchId, dto.moduleId);
      this.assertModuleInRoleTemplate(targetRoleKey, dto.moduleId);
    }

    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.isDefault === true) {
        await tx.userBranchProfile.updateMany({
          where: { tenantId, personId, isDefault: true },
          data: { isDefault: false },
        });
      }
      const data: Prisma.UserBranchProfileUpdateInput = {};
      if (newRole) data.authRole = { connect: { id: newRole.id } };
      if (dto.branchStatus !== undefined) data.branchStatus = dto.branchStatus;
      if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
      if (dto.moduleId !== undefined) {
        data.defaultModuleId = dto.moduleId ?? null;
      }
      const updated = await tx.userBranchProfile.update({
        where: { id: existing.id },
        data,
      });
      await this.eventEmitter.emitAsync('users.branch.assignment.updated', {
        tenantId,
        personId,
        branchId,
        actorId,
      });
      return updated;
    });
  }

  /**
   * Global deactivate: set the tenant-global membership status to INACTIVE,
   * blocking login tenant-wide. Branch statuses and all records are preserved.
   */
  async deactivateUser(
    tenantId: string,
    personId: string,
    actorId: string,
  ): Promise<TenantStaffMembership> {
    return this.setMembershipStatus(
      tenantId,
      personId,
      StaffStatus.INACTIVE,
      actorId,
    );
  }

  /** Global activate: restore the membership status to ACTIVE. */
  async activateUser(
    tenantId: string,
    personId: string,
    actorId: string,
  ): Promise<TenantStaffMembership> {
    return this.setMembershipStatus(
      tenantId,
      personId,
      StaffStatus.ACTIVE,
      actorId,
    );
  }

  /**
   * Resolve the module-grouped permissions for a (user + branch). The baseline is
   * the role assigned at **that branch** (UserBranchProfile.profileKey). Only
   * modules enabled for the branch are returned; effective `allowed` =
   * override ?? the role baseline.
   */
  async getBranchPermissions(
    tenantId: string,
    personId: string,
    branchId: string,
  ): Promise<ResolvedBranchPermission[]> {
    await this.getMembership(tenantId, personId);
    await this.branchService.findById(branchId, tenantId);
    const profile = await this.prisma.userBranchProfile.findFirst({
      where: { tenantId, personId, branchId, isActive: true, deletedAt: null },
      include: PROFILE_WITH_ROLE,
    });
    if (!profile) {
      return [];
    }
    const enabledModules = await this.getActiveBranchModuleKeys(
      tenantId,
      branchId,
    );
    if (enabledModules.size === 0) {
      return [];
    }
    const baseline = roleBaselinePermissions(profile.authRole?.key ?? '');
    const overrides = await this.prisma.userBranchPermission.findMany({
      where: { tenantId, personId, branchId, deletedAt: null },
    });
    const overrideMap = new Map(
      overrides.map((o) => [o.permissionKey, o.allowed]),
    );

    return MODULE_PERMISSION_CATALOG.filter((e) =>
      enabledModules.has(e.moduleKey),
    ).map((e) => {
      const base = baseline.has(e.permissionKey);
      const override = overrideMap.get(e.permissionKey);
      return {
        moduleKey: e.moduleKey,
        moduleLabel: moduleLabel(e.moduleKey),
        permissionKey: e.permissionKey,
        label: e.label,
        baseline: base,
        allowed: override ?? base,
      };
    });
  }

  /**
   * Resolve the **current user's** effective permissions **at a specific branch**,
   * across the **full** system catalogue (all 14 modules, every action), grouped
   * by module, plus a flat list of granted keys the frontend uses to show/hide
   * features. Every permission is returned with `allowed: true | false` so the
   * frontend can render a complete permission grid.
   *
   * The role is the one the user holds **at that branch** (a branch-level
   * `UserBranchProfile`, else a tenant-level one — `branchId = null`, e.g.
   * `business_admin`/`administrator` — which applies at every branch). Effective
   * `allowed` = `(module enabled for the branch) AND (branch override ?? role
   * baseline)`. The "special" overrides come from `user_branch_permissions` for
   * **this branch only**, so the same user can have different permissions per
   * branch. If the user has no assignment at the branch, every permission is
   * `false` (all-false catalog).
   *
   * The response also carries the **role** driving the permissions at the branch
   * (`{ key, label }`, or `null` when unassigned) and **`branchModules`** — the
   * modules enabled for that branch — so the frontend has the full context in one
   * call.
   *
   * @param tenantId the caller's tenant (from the JWT)
   * @param personId the caller's person id (from the JWT)
   * @param branchId the branch to resolve for (validated against the tenant)
   * @returns the role, the branch's enabled modules, the grouped modules, and a
   *   flat `allowed` key list
   */
  async getMyPermissions(
    tenantId: string,
    personId: string,
    branchId: string,
  ): Promise<MyPermissions> {
    await this.getMembership(tenantId, personId);
    await this.branchService.findById(branchId, tenantId);

    // Modules enabled for the branch (needed for branchModules + the gate), in
    // canonical SYSTEM_MODULES order, independent of the user's role.
    const moduleFilter = await this.getActiveBranchModuleKeys(
      tenantId,
      branchId,
    );
    const branchModules = SYSTEM_MODULES.filter((m) =>
      moduleFilter.has(m.key),
    ).map((m) => ({ moduleKey: m.key, label: m.label }));

    // Role applicable to this branch: prefer a branch-level profile, else a
    // tenant-level one (branchId = null), which applies at every branch.
    const profiles = await this.prisma.userBranchProfile.findMany({
      where: {
        tenantId,
        personId,
        isActive: true,
        deletedAt: null,
        OR: [{ branchId }, { branchId: null }],
      },
      include: PROFILE_WITH_ROLE,
    });
    const activeProfile =
      profiles.find((p) => p.branchId === branchId) ??
      profiles.find((p) => p.branchId === null) ??
      null;
    const roleKey = activeProfile?.authRole?.key ?? null;
    const role: ResolvedRole | null = roleKey
      ? this.roleView(activeProfile?.authRole ?? null)
      : null;

    // No role at this branch → empty baseline + overrides, so every permission
    // resolves to false (all-false catalog), while branchModules still reflects
    // the branch's enabled modules.
    let baseline = new Set<string>();
    let overrideMap = new Map<string, boolean>();
    if (roleKey) {
      baseline = roleBaselinePermissions(roleKey);
      const overrides = await this.prisma.userBranchPermission.findMany({
        where: { tenantId, personId, branchId, deletedAt: null },
      });
      overrideMap = new Map(overrides.map((o) => [o.permissionKey, o.allowed]));
    }

    const grouped = this.groupResolvedPermissions(
      baseline,
      overrideMap,
      moduleFilter,
    );
    return {
      role,
      branchModules,
      modules: grouped.modules,
      allowed: grouped.allowed,
    };
  }

  /**
   * Resolve the permission catalogue into module groups of **allowed** keys,
   * plus a flat list of those same keys. Effective `allowed` is gated by module
   * enablement: a permission whose module is not in `moduleFilter` (not enabled
   * for the branch / not in the role's modules) is always denied; otherwise
   * `allowed` = override ?? baseline. Only allowed `permissionKey`s appear in the
   * output, so a module with no granted permission is omitted entirely (every
   * emitted group therefore has `moduleAllowed: true`). Catalogue order is
   * preserved.
   */
  private groupResolvedPermissions(
    baseline: Set<string>,
    overrideMap: Map<string, boolean>,
    moduleFilter: Set<string>,
  ): GroupedPermissions {
    const groups = new Map<string, PermissionModuleGroup>();
    const allowed: string[] = [];

    for (const entry of MODULE_PERMISSION_CATALOG) {
      const moduleEnabled = moduleFilter.has(entry.moduleKey);
      const base = baseline.has(entry.permissionKey);
      const isAllowed = moduleEnabled
        ? (overrideMap.get(entry.permissionKey) ?? base)
        : false;

      if (!isAllowed) continue; // only allowed keys appear in the output

      let group = groups.get(entry.moduleKey);
      if (!group) {
        group = {
          moduleKey: entry.moduleKey,
          moduleLabel: moduleLabel(entry.moduleKey),
          moduleAllowed: true,
          permissions: [],
        };
        groups.set(entry.moduleKey, group);
      }
      group.permissions.push(entry.permissionKey);
      allowed.push(entry.permissionKey);
    }

    return { modules: [...groups.values()], allowed };
  }

  /**
   * Replace the (user + branch) permission grants. Accepts only modules enabled
   * for the branch; supports Select-All/Deselect-All (client sends the full set).
   */
  async updateBranchPermissions(
    tenantId: string,
    personId: string,
    dto: UpdateBranchPermissionsDto,
    setBy: string,
  ): Promise<void> {
    await this.getMembership(tenantId, personId);
    await this.branchService.findById(dto.branchId, tenantId);
    const enabledModules = await this.getActiveBranchModuleKeys(
      tenantId,
      dto.branchId,
    );
    const validKeys = new Map(
      MODULE_PERMISSION_CATALOG.map((e) => [e.permissionKey, e.moduleKey]),
    );

    for (const item of dto.items) {
      if (!isValidModuleKey(item.moduleKey)) {
        throw new InvalidModuleKeyException(item.moduleKey);
      }
      if (!enabledModules.has(item.moduleKey)) {
        throw new ModuleNotEnabledForBranchException(
          item.moduleKey,
          dto.branchId,
        );
      }
      if (validKeys.get(item.permissionKey) !== item.moduleKey) {
        throw new InvalidModuleKeyException(item.moduleKey);
      }
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.userBranchPermission.deleteMany({
        where: { tenantId, personId, branchId: dto.branchId },
      });
      if (dto.items.length > 0) {
        await tx.userBranchPermission.createMany({
          data: dto.items.map((item) => ({
            tenantId,
            personId,
            branchId: dto.branchId,
            moduleKey: item.moduleKey,
            permissionKey: item.permissionKey,
            allowed: item.allowed,
            setBy,
          })),
        });
      }
    });
    this.logger.log(
      `Branch permissions updated for person ${personId} branch ${dto.branchId} by ${setBy}`,
    );
  }

  /**
   * Permissions screen listing: one row per (globally-Active user + branch).
   * Status is always Active in this view (inactive users are excluded).
   */
  async listProfilePermissions(
    tenantId: string,
  ): Promise<ProfilePermissionRow[]> {
    const memberships = await this.prisma.tenantStaffMembership.findMany({
      where: { tenantId, deletedAt: null, status: StaffStatus.ACTIVE },
    });
    if (memberships.length === 0) {
      return [];
    }
    const personIds = memberships.map((m) => m.personId);
    const membershipMap = new Map(memberships.map((m) => [m.personId, m]));
    const [credentials, profiles] = await Promise.all([
      this.prisma.personCredentials.findMany({
        where: { personId: { in: personIds } },
      }),
      this.prisma.userBranchProfile.findMany({
        where: {
          tenantId,
          personId: { in: personIds },
          isActive: true,
          deletedAt: null,
          branchId: { not: null },
        },
        include: PROFILE_WITH_ROLE,
      }),
    ]);
    const credMap = new Map(credentials.map((c) => [c.personId, c]));
    const branchIds = [
      ...new Set(
        profiles.map((p) => p.branchId).filter((b): b is string => !!b),
      ),
    ];
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: branchIds }, tenantId },
    });
    const branchNameMap = new Map(branches.map((b) => [b.id, b.name]));

    return profiles.map((p) => {
      const m = membershipMap.get(p.personId);
      const cred = credMap.get(p.personId);
      const rv = this.roleView(p.authRole);
      return {
        id: p.id,
        userCode: m?.userCode ?? '',
        username: cred?.systemUsername ?? null,
        role: rv.key,
        roleLabel: rv.label,
        branch: p.branchId ? (branchNameMap.get(p.branchId) ?? '') : '',
        status: StaffStatus.ACTIVE,
      };
    });
  }

  // ── SiteAdmin: Registered Users (cross-portal) ──────────────────────────────

  /**
   * List every registered person across the whole portal (SiteAdmin surface,
   * no tenant filtering). `persons` / `person_credentials` are platform-level
   * (no RLS), so this is a normal paginated DB query. `search` matches the
   * person's email or login username (case-insensitive); `status` maps to
   * `Person.isActive`. `userType` is derived from the `isStaff` / `isPatient`
   * flags.
   * @param query pagination + optional `search` / `status`
   * @returns `{ data, total, page, limit }` for the `meta` envelope
   */
  async listRegisteredUsers(
    query: ListRegisteredUsersQueryDto,
  ): Promise<PaginatedResult<RegisteredUserRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.PersonWhereInput = { deletedAt: null };
    if (query.status) {
      where.isActive = query.status === 'active';
    }
    const search = query.search?.trim();
    if (search) {
      // No Person↔PersonCredentials Prisma relation exists, so resolve
      // username matches to person ids first, then OR with the email match.
      const credMatches = await this.prisma.personCredentials.findMany({
        where: {
          systemUsername: { contains: search, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { personId: true },
      });
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { id: { in: credMatches.map((c) => c.personId) } },
      ];
    }

    const [persons, total] = await this.prisma.$transaction([
      this.prisma.person.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.person.count({ where }),
    ]);

    const credentials = await this.prisma.personCredentials.findMany({
      where: { personId: { in: persons.map((p) => p.id) } },
      select: { personId: true, systemUsername: true },
    });
    const usernameMap = new Map(
      credentials.map((c) => [c.personId, c.systemUsername]),
    );

    const data: RegisteredUserRow[] = persons.map((p) => ({
      id: p.id,
      name: [p.firstName, p.lastName].filter(Boolean).join(' '),
      username: usernameMap.get(p.id) ?? null,
      email: p.email,
      userType: p.isStaff ? 'STAFF' : 'PATIENT',
      status: p.isActive ? 'ACTIVE' : 'INACTIVE',
    }));
    return { data, total, page, limit };
  }

  /**
   * Full read-only detail for one registered person (SiteAdmin surface): the
   * person's identity (Aadhaar masked), login identifiers, and all staff
   * memberships across businesses with per-branch roles. Membership/role data
   * lives in RLS-protected tables, so each business is queried under its own
   * `withTenant` context; a pure patient yields an empty `memberships` array.
   * @param personId the person to load
   * @returns the person, login identifiers, and business memberships
   * @throws PersonNotFoundException if the person is missing
   */
  async getRegisteredUser(personId: string): Promise<RegisteredUserDetail> {
    const person = await this.findById(personId);
    const cred = await this.prisma.personCredentials.findUnique({
      where: { personId },
    });

    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });

    const memberships: RegisteredUserMembership[] = [];
    for (const tenant of tenants) {
      const scoped = await this.prisma.withTenant(tenant.id, async (tx) => {
        const membership = await tx.tenantStaffMembership.findFirst({
          where: { personId, deletedAt: null },
          include: { authRole: true },
        });
        if (!membership) {
          return null;
        }
        const profiles = await tx.userBranchProfile.findMany({
          where: { personId, isActive: true, deletedAt: null },
          include: PROFILE_WITH_ROLE,
        });
        const branchIds = profiles
          .map((p) => p.branchId)
          .filter((b): b is string => !!b);
        const branches = branchIds.length
          ? await tx.branch.findMany({ where: { id: { in: branchIds } } })
          : [];
        return { membership, profiles, branches };
      });
      if (!scoped) {
        continue;
      }

      const branchNameMap = new Map(scoped.branches.map((b) => [b.id, b.name]));
      const defaultProfile =
        scoped.profiles.find((p) => p.isDefault) ?? scoped.profiles[0] ?? null;
      const primary = this.roleView(
        scoped.membership.authRole ?? defaultProfile?.authRole ?? null,
      );

      memberships.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        userCode: scoped.membership.userCode,
        userType: scoped.membership.userType,
        status: scoped.membership.status,
        roleKey: primary.key || null,
        roleLabel: primary.label || null,
        branches: scoped.profiles.map((p) => {
          const rv = this.roleView(p.authRole);
          return {
            branchId: p.branchId,
            branchName: p.branchId
              ? (branchNameMap.get(p.branchId) ?? null)
              : null,
            roleKey: rv.key,
            roleLabel: rv.label,
            branchStatus: p.branchStatus,
            isDefault: p.isDefault,
            moduleLabel: p.defaultModuleId
              ? moduleLabel(p.defaultModuleId)
              : null,
          };
        }),
      });
    }

    const { aadhaarNumber, ...rest } = person;
    return {
      person: { ...rest, aadhaarMasked: this.maskAadhaar(aadhaarNumber) },
      username: cred?.systemUsername ?? null,
      loginPhone: cred?.phone ?? null,
      loginEmail: cred?.email ?? null,
      userType: person.isStaff ? 'STAFF' : 'PATIENT',
      status: person.isActive ? 'ACTIVE' : 'INACTIVE',
      memberships,
    };
  }

  // ── v2.0 private helpers ─────────────────────────────────────────────────────

  /** Throw UnderageUserException if the DOB is younger than the minimum age. */
  private assertAdult(dob: string): void {
    const d = new Date(dob);
    const now = new Date();
    const threshold = new Date(
      now.getFullYear() - MIN_USER_AGE,
      now.getMonth(),
      now.getDate(),
    );
    if (Number.isNaN(d.getTime()) || d.getTime() > threshold.getTime()) {
      throw new UnderageUserException(MIN_USER_AGE);
    }
  }

  /** Ownership guard: owner tenant, self, or self-registered. */
  private assertCanEdit(
    person: Person,
    tenantId: string,
    actorId: string,
  ): void {
    const isOwner = person.ownerTenantId === tenantId;
    const isSelf = actorId === person.id;
    const isSelfRegistered = person.ownerTenantId === null;
    if (!isOwner && !isSelf && !isSelfRegistered) {
      throw new NotOwnerTenantException(tenantId, person.id);
    }
  }

  /** Fetch the tenant membership for a person (with its role relation) or throw. */
  private async getMembership(
    tenantId: string,
    personId: string,
  ): Promise<MembershipWithRole> {
    const m = await this.prisma.tenantStaffMembership.findFirst({
      where: { tenantId, personId, deletedAt: null },
      include: { authRole: true },
    });
    if (!m) {
      throw new StaffMembershipNotFoundException(personId, tenantId);
    }
    return m;
  }

  /**
   * Reshape a membership for API responses, re-deriving the informational
   * `roleKey` (dropped as a column; now sourced from the role relation) so the
   * response contract is preserved.
   */
  private membershipResponse(
    m: MembershipWithRole,
  ): TenantStaffMembership & { roleKey: string | null } {
    const { authRole, ...rest } = m;
    return { ...rest, roleKey: authRole?.key ?? null };
  }

  /** Set the tenant-global membership status and emit an event. */
  private async setMembershipStatus(
    tenantId: string,
    personId: string,
    status: StaffStatus,
    actorId: string,
  ): Promise<TenantStaffMembership> {
    const membership = await this.getMembership(tenantId, personId);
    const updated = await this.prisma.tenantStaffMembership.update({
      where: { id: membership.id },
      data: { status },
    });
    await this.eventEmitter.emitAsync('users.user.status.changed', {
      tenantId,
      personId,
      status,
      actorId,
    });
    return updated;
  }

  /** Throw UsernameTakenException if the username is already in use. */
  private async assertUsernameUnique(username: string): Promise<void> {
    const existing = await this.prisma.personCredentials.findFirst({
      where: { systemUsername: username, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new UsernameTakenException(username);
    }
  }

  /** Throw PersonPhoneTakenException if the phone belongs to a different person. */
  private async assertPhoneUnique(
    phone: string,
    excludePersonId: string,
  ): Promise<void> {
    const existing = await this.prisma.person.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true },
    });
    if (existing && existing.id !== excludePersonId) {
      throw new PersonPhoneTakenException(phone);
    }
  }

  /** The module keys enabled (and not soft-deleted) for a branch. */
  private async getActiveBranchModuleKeys(
    tenantId: string,
    branchId: string,
  ): Promise<Set<string>> {
    const rows = await this.prisma.branchModule.findMany({
      where: { tenantId, branchId, isEnabled: true, deletedAt: null },
      select: { moduleKey: true },
    });
    return new Set(rows.map((r) => r.moduleKey));
  }

  /** Validate a module key exists and is enabled for the branch. */
  private async assertModuleEnabledForBranch(
    tenantId: string,
    branchId: string,
    moduleKey: string,
  ): Promise<void> {
    if (!isValidModuleKey(moduleKey)) {
      throw new InvalidModuleKeyException(moduleKey);
    }
    const enabled = await this.getActiveBranchModuleKeys(tenantId, branchId);
    if (!enabled.has(moduleKey)) {
      throw new ModuleNotEnabledForBranchException(moduleKey, branchId);
    }
  }

  /**
   * If a role template links specific modules, the chosen module must be one of
   * them. Templates with no linked modules accept any (branch-enabled) module.
   */
  private assertModuleInRoleTemplate(roleKey: string, moduleKey: string): void {
    const linked = roleTemplateModules(roleKey);
    if (linked.length > 0 && !linked.includes(moduleKey)) {
      throw new ModuleNotInRoleTemplateException(moduleKey, roleKey);
    }
  }

  /**
   * Validate + normalise a list of branch assignments. Each item carries its own
   * role (falling back to the membership's optional primary role); the role must be
   * branch-level and valid for the branch type, the branch must belong to the
   * tenant, any module must be enabled (and linked to the role template), and at
   * most one branch may be default (the first is defaulted when none is flagged).
   */
  private async prepareBranchAssignments(
    tenantId: string,
    fallbackRoleKey: string | null,
    items: BranchAssignmentItemDto[],
  ): Promise<PreparedAssignment[]> {
    if (items.length === 0) {
      return [];
    }

    const byBranch = new Map<string, BranchAssignmentItemDto>();
    for (const it of items) {
      byBranch.set(it.branchId, it);
    }
    const unique = [...byBranch.values()];
    const defaultsCount = unique.filter((i) => i.isDefault).length;
    if (defaultsCount > 1) {
      throw new MultipleDefaultBranchException();
    }

    const prepared: PreparedAssignment[] = [];
    for (const [idx, it] of unique.entries()) {
      const roleKey = it.roleKey ?? fallbackRoleKey;
      if (!roleKey) {
        throw new ProfileInvalidForBranchException('none', 'unknown');
      }
      // Resolve the role (throws RoleNotFoundException if unknown — replaces the
      // old static registry check, and now accepts tenant custom roles too).
      const role = await this.authRoleService.resolveByKey(tenantId, roleKey);
      if (this.isTenantLevelRole(role)) {
        throw new ProfileInvalidForBranchException(
          roleKey,
          'none — this is a tenant-level role and cannot be assigned to a branch',
        );
      }
      // Branch-type restriction lifted: any branch-level role may be assigned to
      // any branch type. We still verify the branch belongs to the caller's
      // tenant (findById throws if it doesn't) per the never-trust-client-branchId rule.
      await this.branchService.findById(it.branchId, tenantId);
      let moduleId: string | null = null;
      if (it.moduleId) {
        await this.assertModuleEnabledForBranch(
          tenantId,
          it.branchId,
          it.moduleId,
        );
        this.assertModuleInRoleTemplate(role.key, it.moduleId);
        moduleId = it.moduleId;
      }
      prepared.push({
        branchId: it.branchId,
        authRoleId: role.id,
        roleKey: role.key,
        isDefault: defaultsCount === 0 ? idx === 0 : !!it.isDefault,
        defaultModuleId: moduleId,
        branchStatus: it.branchStatus ?? StaffStatus.ACTIVE,
      });
    }
    return prepared;
  }

  /** Apply search/branch/role/module filters to the assembled user rows. */
  private applyUserListFilters(
    rows: UserListRow[],
    query: ListUsersQueryDto,
    profilesByPerson: Map<string, UserBranchProfileWithRole[]>,
  ): UserListRow[] {
    let out = rows;
    if (query.search) {
      const q = query.search.toLowerCase();
      out = out.filter(
        (r) =>
          r.employeeName.toLowerCase().includes(q) ||
          (r.username ?? '').toLowerCase().includes(q) ||
          (r.email ?? '').toLowerCase().includes(q) ||
          r.userCode.toLowerCase().includes(q),
      );
    }
    if (query.branchId) {
      const branchId = query.branchId;
      out = out.filter((r) =>
        (profilesByPerson.get(r.id) ?? []).some((p) => p.branchId === branchId),
      );
    }
    if (query.role) {
      const role = query.role;
      // Role is per-branch: match any of the user's branch roles (or the primary).
      out = out.filter(
        (r) =>
          r.role === role ||
          (profilesByPerson.get(r.id) ?? []).some(
            (p) => p.authRole?.key === role,
          ),
      );
    }
    if (query.moduleKey) {
      const mk = query.moduleKey;
      out = out.filter((r) =>
        (profilesByPerson.get(r.id) ?? []).some(
          (p) => p.defaultModuleId === mk,
        ),
      );
    }
    return out;
  }

  /** Sort user rows by the requested column/direction (in memory). */
  private sortUserRows(
    rows: UserListRow[],
    sortBy?: UserSortField,
    sortOrder?: 'asc' | 'desc',
  ): UserListRow[] {
    if (!sortBy) {
      return rows;
    }
    const dir = sortOrder === 'desc' ? -1 : 1;
    const val = (r: UserListRow): string => {
      switch (sortBy) {
        case 'userCode':
          return r.userCode;
        case 'employeeName':
          return r.employeeName;
        case 'email':
          return r.email ?? '';
        case 'mobile':
          return r.mobile ?? '';
        case 'role':
          return r.roleLabel;
        case 'assignedBranches':
          return r.assignedBranches.join(', ');
        case 'defaultBranch':
          return r.defaultBranch ?? '';
        case 'defaultModule':
          return r.defaultModule ?? '';
        case 'status':
          return r.status;
        default:
          return '';
      }
    };
    return [...rows].sort((a, b) => val(a).localeCompare(val(b)) * dir);
  }

  /** Decrypt and mask an Aadhaar value for display (XXXX-XXXX-1234). */
  private maskAadhaar(enc: string | null): string | null {
    if (!enc) {
      return null;
    }
    try {
      const digits = this.encryptionService.decrypt(enc);
      if (digits.length < 4) {
        return 'XXXX-XXXX-XXXX';
      }
      return `XXXX-XXXX-${digits.slice(-4)}`;
    } catch {
      return null;
    }
  }

  /** Throw if the phone/email is already registered to another person. */
  private async assertContactUnique(
    phone?: string,
    email?: string,
  ): Promise<void> {
    if (phone) {
      const existing = await this.prisma.person.findFirst({
        where: { phone, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        throw new PersonPhoneTakenException(phone);
      }
    }
    if (email) {
      const existing = await this.prisma.person.findFirst({
        where: { email, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        throw new PersonEmailTakenException(email);
      }
    }
  }

  /** Generate a globally-unique platform MRN: `KAL-YYYYMMDD-XXXXXXXX`. */
  private generatePlatformMrn(): string {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    return `KAL-${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
