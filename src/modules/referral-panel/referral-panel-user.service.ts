import { Injectable } from '@nestjs/common';
import { StaffStatus, UserType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConflictException,
  NotFoundException,
} from '../../common/exceptions/kaltros.exception';
import { UsersService } from '../users/users.service';
import { CreateReferralPanelUserDto } from './dto/create-referral-panel-user.dto';

/** The fixed role + modules assigned to every referral-panel login. */
const B2B_ROLE_KEY = 'b2b_referring_panel';
const B2B_MODULES = ['registration', 'finance', 'lab_operations'];
const B2B_DEFAULT_MODULE = 'registration';

/** Guard: the panel must have a branch (the B2B user's branch is taken from it). */
export function assertPanelHasBranch(panel: {
  id: string;
  branchId: string | null;
}): void {
  if (!panel.branchId) {
    throw new ConflictException(
      'REFERRAL_PANEL_HAS_NO_BRANCH',
      'Set this referral panel’s branch before creating its login user.',
      { panelId: panel.id },
    );
  }
}

/** Guard: only one B2B login per panel (1:1). */
export function assertNoExistingB2bUser(
  panelId: string,
  existing: { id: string } | null,
): void {
  if (existing) {
    throw new ConflictException(
      'REFERRAL_PANEL_USER_EXISTS',
      'This referral panel already has a login user.',
      { panelId },
    );
  }
}

/**
 * Creates and fetches the single dedicated "B2B Referring Panel" login for a
 * referral panel. Branch, role, modules, default flags and status are all
 * server-controlled — the caller only supplies personal/login details.
 */
@Injectable()
export class ReferralPanelUserService {
  /**
   * @param prisma the Prisma service
   * @param usersService the shared user-creation service (identity + credentials)
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Create the panel's B2B login. Validates the panel exists, has a branch, and
   * has no existing login; then creates the Person + credentials + membership +
   * one B2B UserBranchProfile scoped to the panel and its branch.
   * @param tenantId caller's tenant (from JWT)
   * @param panelId the referral panel id (from the route)
   * @param dto personal + login fields
   * @param createdBy the acting person id
   * @returns the generated user code, login identifier, and the new person id
   */
  async create(
    tenantId: string,
    panelId: string,
    dto: CreateReferralPanelUserDto,
    createdBy: string,
  ): Promise<{ userCode: string; loginIdentifier: string; personId: string }> {
    const panel = await this.prisma.referralPanel.findFirst({
      where: { id: panelId, tenantId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (!panel) throw new NotFoundException('referral-panel', panelId);
    assertPanelHasBranch(panel);
    assertNoExistingB2bUser(
      panelId,
      await this.findExistingProfile(tenantId, panelId),
    );

    // Create identity + credentials + membership via the shared service, with a
    // single B2B branch assignment. `modules` is intentionally omitted so the
    // shared service skips branch-enablement validation (which would hard-fail
    // if the branch has not enabled finance/lab_operations); the module set is
    // stamped on the profile below and re-intersected with branch-enabled modules
    // at read time.
    const created = await this.usersService.createUser(
      tenantId,
      {
        employeeName: dto.employeeName,
        username: dto.username,
        dateOfBirth: dto.dateOfBirth,
        gender: dto.gender,
        email: dto.email,
        mobileNumber: dto.mobileNumber,
        password: dto.password,
        address: dto.address,
        userType: UserType.EXTERNAL,
        roleKey: B2B_ROLE_KEY,
        status: StaffStatus.ACTIVE,
        branches: [
          { branchId: panel.branchId!, role: B2B_ROLE_KEY, status: StaffStatus.ACTIVE },
        ],
      },
      createdBy,
    );

    // Stamp the panel link + fixed module set on the freshly-created profile.
    // `defaultModuleId` stores the module KEY (see UsersService), not a row id.
    // `isDefault:false` honours the "Default Branch: No" rule (a single-profile
    // user still resolves its active branch without a default).
    await this.prisma.userBranchProfile.updateMany({
      where: {
        tenantId,
        personId: created.person.id,
        branchId: panel.branchId!,
        deletedAt: null,
      },
      data: {
        referralPanelId: panelId,
        defaultModuleId: B2B_DEFAULT_MODULE,
        enabledModules: B2B_MODULES,
        isDefault: false,
      },
    });

    return {
      userCode: created.userCode,
      loginIdentifier: created.loginIdentifier,
      personId: created.person.id,
    };
  }

  /**
   * The existing B2B login profile for a panel, or null.
   * @param tenantId caller's tenant
   * @param panelId the referral panel id
   */
  findExistingProfile(
    tenantId: string,
    panelId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.userBranchProfile.findFirst({
      where: { tenantId, referralPanelId: panelId, deletedAt: null },
      select: { id: true },
    });
  }

  /**
   * Fetch the panel's B2B user summary (for the "Edit" state of the button), or
   * null when the panel has no login yet. `UserBranchProfile` has no `person`
   * relation, so the person is fetched separately (platform-level table).
   * @param tenantId caller's tenant
   * @param panelId the referral panel id
   */
  async getForPanel(
    tenantId: string,
    panelId: string,
  ): Promise<{
    id: string;
    personId: string;
    person: { firstName: string; email: string | null; phone: string | null } | null;
  } | null> {
    const profile = await this.prisma.userBranchProfile.findFirst({
      where: { tenantId, referralPanelId: panelId, deletedAt: null },
      select: { id: true, personId: true },
    });
    if (!profile) return null;
    const person = await this.prisma.person.findFirst({
      where: { id: profile.personId },
      select: { firstName: true, email: true, phone: true },
    });
    return { id: profile.id, personId: profile.personId, person };
  }
}
