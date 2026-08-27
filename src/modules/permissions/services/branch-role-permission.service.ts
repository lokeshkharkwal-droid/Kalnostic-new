import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BranchService } from '../../branch/branch.service';
import { AuthRoleService } from '../../auth-role/auth-role.service';
import type { ResolvedBranchPermission } from '../../users/users.service';
import {
  InvalidModuleKeyException,
  ModuleNotEnabledForBranchException,
} from '../../users/exceptions/users.exceptions';
import {
  MODULE_PERMISSION_CATALOG,
  roleBaselinePermissions,
} from '../constants/module-permissions.constant';
import {
  isValidModuleKey,
  moduleLabel,
} from '../constants/system-modules.constant';
import { UpdateBranchRolePermissionsDto } from '../dto/update-branch-role-permissions.dto';

/** One row of the Business Admin Branch × Role permission grid. */
export interface BranchRoleGridRow {
  branchId: string;
  branchName: string;
  authRoleId: string;
  roleKey: string;
  roleLabel: string;
  /** Whether the role itself is active (AuthRole.isActive). */
  roleActive: boolean;
  /** How many permission keys are overridden for this (branch + role). */
  overriddenCount: number;
}

/**
 * Tier-2 permission management: the branch-level role overrides that sit between
 * the static role baseline (code) and per-user overrides (`UserBranchPermission`).
 * Resolution precedence (applied in `UsersService`): user override ?? branch-role
 * override ?? role baseline.
 *
 * Business Admin manages every Branch × Role combination; Branch Admin manages
 * the roles of their own branch (branch scoping is enforced in the controller).
 */
@Injectable()
export class BranchRolePermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
    private readonly authRoleService: AuthRoleService,
  ) {}

  /**
   * The full Branch × Role grid for a tenant (every branch × every role — the
   * cartesian is computed here; only overrides are stored). Each row carries the
   * count of overridden permission keys so the admin sees where overrides exist.
   */
  async listGrid(tenantId: string): Promise<BranchRoleGridRow[]> {
    const branchOptions =
      await this.branchService.findOptionsForTenant(tenantId);
    const branches = Array.isArray(branchOptions)
      ? branchOptions
      : branchOptions.data;
    // System + custom roles visible to the tenant (high limit = "all").
    const rolesResult = await this.authRoleService.findAllForTenant(
      tenantId,
      1,
      1000,
    );
    const roles = rolesResult.data;

    const grouped = await this.prisma.branchRolePermission.groupBy({
      by: ['branchId', 'authRoleId'],
      where: { tenantId, deletedAt: null },
      _count: { _all: true },
    });
    const countMap = new Map(
      grouped.map((g) => [`${g.branchId}:${g.authRoleId}`, g._count._all]),
    );

    const rows: BranchRoleGridRow[] = [];
    for (const branch of branches) {
      for (const role of roles) {
        rows.push({
          branchId: branch.id,
          branchName: branch.name,
          authRoleId: role.id,
          roleKey: role.key,
          roleLabel: role.name,
          roleActive: role.isActive,
          overriddenCount: countMap.get(`${branch.id}:${role.id}`) ?? 0,
        });
      }
    }
    return rows;
  }

  /**
   * Resolve the module-grouped permissions for a (branch + role). Baseline is the
   * static role template (gated by the branch's enabled modules); effective
   * `allowed` = branch-role override ?? baseline. Returns an empty array when the
   * branch has no modules enabled.
   */
  async getForBranchRole(
    tenantId: string,
    branchId: string,
    authRoleId: string,
  ): Promise<ResolvedBranchPermission[]> {
    await this.branchService.findById(branchId, tenantId);
    const role = await this.authRoleService.findById(tenantId, authRoleId);
    const enabledModules = await this.getEnabledModuleKeys(tenantId, branchId);
    if (enabledModules.size === 0) {
      return [];
    }
    const baseline = roleBaselinePermissions(role.key);
    const overrides = await this.prisma.branchRolePermission.findMany({
      where: { tenantId, branchId, authRoleId, deletedAt: null },
    });
    const overrideMap = new Map(
      overrides.map((o) => [o.permissionKey, o.allowed]),
    );

    return MODULE_PERMISSION_CATALOG.filter((e) =>
      enabledModules.has(e.moduleKey),
    ).map((e) => {
      const base = baseline.has(e.permissionKey);
      return {
        moduleKey: e.moduleKey,
        moduleLabel: moduleLabel(e.moduleKey),
        section: e.section,
        sectionLabel: e.sectionLabel,
        permissionKey: e.permissionKey,
        label: e.label,
        baseline: base,
        allowed: overrideMap.get(e.permissionKey) ?? base,
      };
    });
  }

  /**
   * Replace the (branch + role) permission overrides. Accepts only modules
   * enabled for the branch; supports Select-All / Deselect-All (client sends the
   * full desired set). Delete-then-create in one tenant-scoped transaction.
   */
  async updateForBranchRole(
    tenantId: string,
    branchId: string,
    authRoleId: string,
    dto: UpdateBranchRolePermissionsDto,
    setBy: string,
  ): Promise<void> {
    await this.branchService.findById(branchId, tenantId);
    const role = await this.authRoleService.findById(tenantId, authRoleId);
    const enabledModules = await this.getEnabledModuleKeys(tenantId, branchId);
    const validKeys = new Map(
      MODULE_PERMISSION_CATALOG.map((e) => [e.permissionKey, e.moduleKey]),
    );

    for (const item of dto.items) {
      if (!isValidModuleKey(item.moduleKey)) {
        throw new InvalidModuleKeyException(item.moduleKey);
      }
      if (!enabledModules.has(item.moduleKey)) {
        throw new ModuleNotEnabledForBranchException(item.moduleKey, branchId);
      }
      if (validKeys.get(item.permissionKey) !== item.moduleKey) {
        throw new InvalidModuleKeyException(item.moduleKey);
      }
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.branchRolePermission.deleteMany({
        where: { tenantId, branchId, authRoleId },
      });
      if (dto.items.length > 0) {
        await tx.branchRolePermission.createMany({
          data: dto.items.map((item) => ({
            tenantId,
            branchId,
            authRoleId,
            roleKey: role.key,
            moduleKey: item.moduleKey,
            permissionKey: item.permissionKey,
            allowed: item.allowed,
            setBy,
          })),
        });
      }
    });
  }

  /** The set of module keys enabled for a branch (mirrors the users resolver). */
  private async getEnabledModuleKeys(
    tenantId: string,
    branchId: string,
  ): Promise<Set<string>> {
    const rows = await this.prisma.branchModule.findMany({
      where: { tenantId, branchId, isEnabled: true, deletedAt: null },
      select: { moduleKey: true },
    });
    return new Set(rows.map((r) => r.moduleKey));
  }
}
