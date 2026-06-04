import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Person, Prisma, UserBranchProfile } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../security/password.service';
import { UsernameGeneratorService } from '../security/username-generator.service';
import { BranchService } from '../branch/branch.service';
import {
  PERMISSION_CATALOG,
} from '../permissions/constants/permission-catalog.constant';
import { PROFILE_PERMISSIONS } from '../permissions/constants/permissions.constant';
import {
  isProfileValidForBranch,
  isValidProfileKey,
  PROFILE_BRANCH_MATRIX,
  ProfileKey,
} from '../permissions/constants/profile-registry.constant';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { RegisterStaffDto } from './dto/register-staff.dto';
import {
  NotOwnerTenantException,
  PersonEmailTakenException,
  PersonNotFoundException,
  PersonPhoneTakenException,
  ProfileAlreadyAssignedException,
  ProfileInvalidForBranchException,
  ProfileNotFoundException,
} from './exceptions/users.exceptions';

/** A staff member with their profile assignments (for the staff roster screen). */
export interface StaffMemberDto {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  platformMrn: string;
  profiles: Array<{
    branchId: string | null;
    branchName: string | null;
    profileKey: string;
    isDefault: boolean;
    assignedAt: Date;
  }>;
}

/** A permission row with its resolved effective value. */
export interface ResolvedPermission {
  code: string;
  name: string;
  group: string;
  baselineValue: boolean;
  override: 'allow' | 'deny' | 'inherit';
  effectiveValue: boolean;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly usernameService: UsernameGeneratorService,
    private readonly branchService: BranchService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Register a person (patient or staff). Generates a global platform MRN and
   * sets the registering business as owner.
   * @param tenantId registering business (becomes owner)
   * @param dto demographics
   * @param createdBy actor person id
   * @param isPatient whether this is a patient registration
   */
  async registerPerson(
    tenantId: string,
    dto: CreatePersonDto,
    createdBy: string,
    isPatient = true,
  ): Promise<Person> {
    await this.assertContactUnique(dto.phone, dto.email);

    const person = await this.prisma.person.create({
      data: {
        platformMrn: this.generatePlatformMrn(),
        salutation: dto.salutation ?? null,
        firstName: dto.firstName,
        lastName: dto.lastName ?? null,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        gender: dto.gender ?? null,
        bloodGroup: dto.bloodGroup ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: (dto.address ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        ownerTenantId: tenantId,
        isPatient,
        isStaff: false,
        isActive: true,
      },
    });

    await this.eventEmitter.emitAsync('users.person.registered', {
      personId: person.id,
      tenantId,
      isPatient,
      createdBy,
    });
    return person;
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
   * Update a person's basic details. Only the owning tenant, the person
   * themselves, or any tenant for self-registered persons may edit.
   * @param personId person to update
   * @param tenantId tenant making the request
   * @param dto fields to update
   * @param updatedBy actor person id
   */
  async updatePersonDetails(
    personId: string,
    tenantId: string,
    dto: UpdatePersonDto,
    updatedBy: string,
  ): Promise<Person> {
    const person = await this.findById(personId);

    const isOwner = person.ownerTenantId === tenantId;
    const isSelfUpdate = updatedBy === personId;
    const isSelfRegistered = person.ownerTenantId === null;
    if (!isOwner && !isSelfUpdate && !isSelfRegistered) {
      throw new NotOwnerTenantException(tenantId, personId);
    }

    if (dto.phone && dto.phone !== person.phone) {
      const existing = await this.prisma.person.findFirst({
        where: { phone: dto.phone, deletedAt: null },
        select: { id: true },
      });
      if (existing && existing.id !== personId) {
        throw new PersonPhoneTakenException(dto.phone);
      }
    }
    if (dto.email && dto.email !== person.email) {
      const existing = await this.prisma.person.findFirst({
        where: { email: dto.email, deletedAt: null },
        select: { id: true },
      });
      if (existing && existing.id !== personId) {
        throw new PersonEmailTakenException(dto.email);
      }
    }

    const data: Prisma.PersonUpdateInput = {};
    if (dto.salutation !== undefined) data.salutation = dto.salutation ?? null;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName ?? null;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    }
    if (dto.gender !== undefined) data.gender = dto.gender ?? null;
    if (dto.bloodGroup !== undefined) data.bloodGroup = dto.bloodGroup ?? null;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.address !== undefined) {
      data.address = (dto.address ?? Prisma.JsonNull) as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.person.update({
      where: { id: personId },
      data,
    });
    await this.eventEmitter.emitAsync('users.person.updated', {
      personId,
      tenantId,
      updatedBy,
      changes: Object.keys(dto),
    });
    return updated;
  }

  /**
   * Register a staff member: person + credentials (temp password) + initial
   * profile, atomically. Login identifier precedence: phone → email →
   * auto-generated system_username.
   * @param tenantId tenant scope
   * @param dto staff details + target profile/branch
   * @param createdBy admin performing the registration
   * @returns the person, a one-time temp password, and the login identifier
   */
  async registerStaff(
    tenantId: string,
    dto: RegisterStaffDto,
    createdBy: string,
  ): Promise<{ person: Person; tempPassword: string; loginIdentifier: string }> {
    if (!isValidProfileKey(dto.profileKey)) {
      throw new ProfileInvalidForBranchException(dto.profileKey, 'unknown');
    }
    await this.assertContactUnique(dto.phone, dto.email);

    if (dto.branchId) {
      const branch = await this.branchService.findById(dto.branchId, tenantId);
      if (!isProfileValidForBranch(dto.profileKey, branch.branchType)) {
        throw new ProfileInvalidForBranchException(dto.profileKey, branch.branchType);
      }
    }

    const tempPassword = this.passwordService.generateTempPassword();
    const passwordHash = await this.passwordService.hash(tempPassword);

    let systemUsername: string | null = null;
    let loginIdentifier: string;
    if (dto.phone) {
      loginIdentifier = dto.phone;
    } else if (dto.email) {
      loginIdentifier = dto.email;
    } else {
      systemUsername = await this.usernameService.generate();
      loginIdentifier = systemUsername;
    }

    const platformMrn = this.generatePlatformMrn();

    const person = await this.prisma.$transaction(async (tx) => {
      const created = await tx.person.create({
        data: {
          platformMrn,
          firstName: dto.firstName,
          lastName: dto.lastName ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          ownerTenantId: tenantId,
          isPatient: false,
          isStaff: true,
          isActive: true,
        },
      });
      await tx.personCredentials.create({
        data: {
          personId: created.id,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          systemUsername,
          isSystemGeneratedUsername: !!systemUsername,
          passwordHash,
          isTempPassword: true,
        },
      });
      await tx.userBranchProfile.create({
        data: {
          tenantId,
          personId: created.id,
          branchId: dto.branchId ?? null,
          profileKey: dto.profileKey,
          isDefault: true,
          isActive: true,
          assignedAt: new Date(),
          assignedBy: createdBy,
        },
      });
      return created;
    });

    await this.eventEmitter.emitAsync('users.staff.registered', {
      personId: person.id,
      tenantId,
      profileKey: dto.profileKey,
      branchId: dto.branchId ?? null,
      createdBy,
    });
    return { person, tempPassword, loginIdentifier };
  }

  /**
   * Assign a profile to a person at a branch (or tenant-level). Validates the
   * profile key and branch-type compatibility; enforces a single default.
   * @returns the created assignment
   */
  async assignProfile(
    tenantId: string,
    personId: string,
    branchId: string | null,
    profileKey: string,
    assignedBy: string,
    isDefault = false,
  ): Promise<UserBranchProfile> {
    if (!isValidProfileKey(profileKey)) {
      throw new ProfileInvalidForBranchException(profileKey, 'unknown');
    }

    if (branchId) {
      const branch = await this.branchService.findById(branchId, tenantId);
      if (!isProfileValidForBranch(profileKey, branch.branchType)) {
        throw new ProfileInvalidForBranchException(profileKey, branch.branchType);
      }
    } else if ((PROFILE_BRANCH_MATRIX[profileKey as ProfileKey] ?? []).length > 0) {
      throw new ProfileInvalidForBranchException(
        profileKey,
        'none — this profile requires a branch',
      );
    }

    const existing = await this.findExistingProfile(tenantId, personId, branchId, profileKey);
    if (existing && existing.isActive) {
      throw new ProfileAlreadyAssignedException(
        personId,
        branchId ?? 'tenant',
        profileKey,
      );
    }

    if (isDefault) {
      await this.clearDefaultFlag(tenantId, personId);
    }

    const assignment = await this.prisma.userBranchProfile.create({
      data: {
        tenantId,
        personId,
        branchId: branchId ?? null,
        profileKey,
        isDefault,
        isActive: true,
        assignedAt: new Date(),
        assignedBy,
      },
    });
    await this.prisma.person.update({
      where: { id: personId },
      data: { isStaff: true },
    });
    await this.eventEmitter.emitAsync('users.profile.assigned', {
      tenantId,
      personId,
      branchId,
      profileKey,
      assignedBy,
    });
    return assignment;
  }

  /**
   * Revoke a profile assignment (soft — sets revoked_at / is_active=false). If
   * the person has no remaining active profiles, clears their is_staff flag.
   */
  async revokeProfile(
    tenantId: string,
    personId: string,
    branchId: string | null,
    profileKey: string,
    revokedBy: string,
  ): Promise<void> {
    const existing = await this.findExistingProfile(tenantId, personId, branchId, profileKey);
    if (!existing || !existing.isActive) {
      throw new ProfileNotFoundException(personId, branchId ?? 'tenant');
    }

    await this.prisma.userBranchProfile.update({
      where: { id: existing.id },
      data: { isActive: false, revokedAt: new Date(), revokedBy },
    });

    const remaining = await this.prisma.userBranchProfile.count({
      where: { personId, isActive: true, deletedAt: null },
    });
    if (remaining === 0) {
      await this.prisma.person.update({
        where: { id: personId },
        data: { isStaff: false },
      });
    }
    await this.eventEmitter.emitAsync('users.profile.revoked', {
      tenantId,
      personId,
      branchId,
      profileKey,
      revokedBy,
    });
  }

  /**
   * Set the default landing profile for a person (clears any prior default).
   */
  async setDefaultProfile(
    tenantId: string,
    personId: string,
    profileKey: string,
    branchId: string | null,
  ): Promise<void> {
    const existing = await this.findExistingProfile(tenantId, personId, branchId, profileKey);
    if (!existing || !existing.isActive) {
      throw new ProfileNotFoundException(personId, branchId ?? 'tenant');
    }
    await this.clearDefaultFlag(tenantId, personId);
    await this.prisma.userBranchProfile.update({
      where: { id: existing.id },
      data: { isDefault: true },
    });
  }

  /**
   * All active profile assignments for a person (used to build the JWT).
   */
  async getPersonProfiles(personId: string): Promise<UserBranchProfile[]> {
    return this.prisma.userBranchProfile.findMany({
      where: { personId, isActive: true, deletedAt: null },
    });
  }

  /**
   * List staff for a tenant, grouped by person with their profile assignments.
   * @param tenantId tenant scope
   */
  async listTenantStaff(tenantId: string): Promise<StaffMemberDto[]> {
    const profiles = await this.prisma.userBranchProfile.findMany({
      where: { tenantId, isActive: true, deletedAt: null },
      orderBy: { assignedAt: 'asc' },
    });
    if (profiles.length === 0) {
      return [];
    }

    const personIds = [...new Set(profiles.map((p) => p.personId))];
    const branchIds = [
      ...new Set(profiles.map((p) => p.branchId).filter((b): b is string => !!b)),
    ];
    const [persons, branches] = await Promise.all([
      this.prisma.person.findMany({ where: { id: { in: personIds } } }),
      this.prisma.branch.findMany({ where: { id: { in: branchIds }, tenantId } }),
    ]);
    const personMap = new Map(persons.map((p) => [p.id, p]));
    const branchMap = new Map(branches.map((b) => [b.id, b.name]));

    const staff = new Map<string, StaffMemberDto>();
    for (const profile of profiles) {
      const person = personMap.get(profile.personId);
      if (!person) {
        continue;
      }
      if (!staff.has(person.id)) {
        staff.set(person.id, {
          id: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          phone: person.phone,
          email: person.email,
          platformMrn: person.platformMrn,
          profiles: [],
        });
      }
      staff.get(person.id)!.profiles.push({
        branchId: profile.branchId,
        branchName: profile.branchId ? (branchMap.get(profile.branchId) ?? null) : null,
        profileKey: profile.profileKey,
        isDefault: profile.isDefault,
        assignedAt: profile.assignedAt,
      });
    }
    return [...staff.values()];
  }

  /**
   * Resolve every catalogue permission for a profile assignment, applying
   * per-assignment overrides on top of the profile baseline.
   */
  async getProfilePermissions(
    tenantId: string,
    personId: string,
    branchId: string | null,
    profileKey: string,
  ): Promise<ResolvedPermission[]> {
    const baseline = new Set<string>(
      PROFILE_PERMISSIONS[profileKey as ProfileKey] ?? [],
    );
    const overrides = await this.prisma.userProfilePermissionOverride.findMany({
      where: { tenantId, personId, branchId: branchId ?? null, profileKey, deletedAt: null },
    });
    const overrideMap = new Map(overrides.map((o) => [o.permissionCode, o.override]));

    return PERMISSION_CATALOG.map((entry) => {
      const baselineValue = baseline.has(entry.code);
      const override = (overrideMap.get(entry.code) ?? 'inherit') as
        | 'allow'
        | 'deny'
        | 'inherit';
      const effectiveValue =
        override === 'allow' ? true : override === 'deny' ? false : baselineValue;
      return {
        code: entry.code,
        name: entry.name,
        group: entry.group,
        baselineValue,
        override,
        effectiveValue,
      };
    });
  }

  /**
   * Replace all permission overrides for a profile assignment. Entries with
   * `inherit` are dropped (no row = inherit).
   */
  async setProfilePermissions(
    tenantId: string,
    personId: string,
    branchId: string | null,
    profileKey: string,
    overrides: Array<{ code: string; override: 'allow' | 'deny' | 'inherit' }>,
    setBy: string,
  ): Promise<void> {
    const toStore = overrides
      .filter((o) => o.override === 'allow' || o.override === 'deny')
      .map((o) => ({
        tenantId,
        personId,
        branchId: branchId ?? null,
        profileKey,
        permissionCode: o.code,
        override: o.override,
        setBy,
      }));

    await this.prisma.$transaction([
      this.prisma.userProfilePermissionOverride.deleteMany({
        where: { tenantId, personId, branchId: branchId ?? null, profileKey },
      }),
      this.prisma.userProfilePermissionOverride.createMany({ data: toStore }),
    ]);
    this.logger.log(
      `Permission overrides updated for person ${personId} profile ${profileKey} by ${setBy}`,
    );
  }

  /**
   * Doctors mapped to a receptionist at a branch (with display names).
   */
  async getReceptionistDoctors(
    tenantId: string,
    receptionistPersonId: string,
    branchId: string,
  ): Promise<Array<{ personId: string; firstName: string; lastName: string | null }>> {
    const mappings = await this.prisma.receptionistDoctorMapping.findMany({
      where: { tenantId, branchId, receptionistPersonId, deletedAt: null },
    });
    if (mappings.length === 0) {
      return [];
    }
    const doctors = await this.prisma.person.findMany({
      where: { id: { in: mappings.map((m) => m.doctorPersonId) } },
    });
    return doctors.map((d) => ({
      personId: d.id,
      firstName: d.firstName,
      lastName: d.lastName,
    }));
  }

  /**
   * Replace the doctor mappings for a receptionist at a branch. Each doctor
   * must be an active `doctor` at that branch. Empty array clears mappings.
   */
  async setReceptionistDoctors(
    tenantId: string,
    receptionistPersonId: string,
    branchId: string,
    doctorPersonIds: string[],
    assignedBy: string,
  ): Promise<void> {
    for (const doctorId of doctorPersonIds) {
      const assignment = await this.findExistingProfile(tenantId, doctorId, branchId, 'doctor');
      if (!assignment || !assignment.isActive) {
        throw new ProfileNotFoundException(doctorId, branchId);
      }
    }

    await this.prisma.$transaction([
      this.prisma.receptionistDoctorMapping.deleteMany({
        where: { tenantId, branchId, receptionistPersonId },
      }),
      this.prisma.receptionistDoctorMapping.createMany({
        data: doctorPersonIds.map((doctorPersonId) => ({
          tenantId,
          branchId,
          receptionistPersonId,
          doctorPersonId,
          assignedBy,
        })),
      }),
    ]);
  }

  /**
   * Reset a staff member's password; returns a one-time temp password.
   */
  async resetStaffPassword(
    personId: string,
    tenantId: string,
    actorId: string,
  ): Promise<{ tempPassword: string; loginIdentifier: string }> {
    const person = await this.findById(personId);
    const credentials = await this.prisma.personCredentials.findUnique({
      where: { personId },
    });
    if (!credentials) {
      throw new PersonNotFoundException(personId);
    }

    const tempPassword = this.passwordService.generateTempPassword();
    const passwordHash = await this.passwordService.hash(tempPassword);
    const loginIdentifier =
      person.phone ?? person.email ?? credentials.systemUsername ?? personId;

    await this.prisma.personCredentials.update({
      where: { personId },
      data: { passwordHash, isTempPassword: true, failedAttempts: 0, lockedUntil: null },
    });
    await this.eventEmitter.emitAsync('users.password.reset', {
      personId,
      tenantId,
      resetBy: actorId,
    });
    return { tempPassword, loginIdentifier };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Find an active-or-inactive assignment for (person, branch, profile). */
  private findExistingProfile(
    tenantId: string,
    personId: string,
    branchId: string | null,
    profileKey: string,
  ): Promise<UserBranchProfile | null> {
    return this.prisma.userBranchProfile.findFirst({
      where: { tenantId, personId, branchId: branchId ?? null, profileKey, deletedAt: null },
    });
  }

  /** Clear the default flag from all of a person's profiles in a tenant. */
  private async clearDefaultFlag(tenantId: string, personId: string): Promise<void> {
    await this.prisma.userBranchProfile.updateMany({
      where: { tenantId, personId, isDefault: true },
      data: { isDefault: false },
    });
  }

  /** Throw if the phone/email is already registered to another person. */
  private async assertContactUnique(phone?: string, email?: string): Promise<void> {
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
