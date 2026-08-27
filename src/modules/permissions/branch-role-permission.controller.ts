import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { BranchRolePermissionService } from './services/branch-role-permission.service';
import { UpdateBranchRolePermissionsDto } from './dto/update-branch-role-permissions.dto';
import { BranchScopeViolationException } from './exceptions/permissions.exceptions';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Branch × Role permission management (business-authenticated; tenant + actor
 * from the JWT). This is the tier-2 layer: the branch-level role overrides that
 * sit between the static role baseline and per-user overrides.
 *
 * - Business Admin (tenant-level context, `active_branch_id = null`) manages
 *   every Branch × Role combination.
 * - Branch Admin (branch-level context) manages only the roles of their own
 *   active branch — enforced by {@link assertBranchInScope}.
 *
 * Responses use the global `meta` envelope.
 */
@Controller('permissions/branch-roles')
export class BranchRolePermissionController {
  constructor(
    private readonly branchRolePermissions: BranchRolePermissionService,
  ) {}

  /**
   * The full Branch × Role grid for the tenant (Business Admin). Each row carries
   * the count of overridden permission keys.
   */
  @Get('grid')
  grid(@CurrentTenant() tenantId: string) {
    return this.branchRolePermissions.listGrid(tenantId);
  }

  /** Resolve the module-grouped permissions for one (branch + role). */
  @Get(':branchId/:authRoleId')
  getForBranchRole(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('branchId') branchId: string,
    @Param('authRoleId') authRoleId: string,
  ) {
    this.assertBranchInScope(profile, branchId);
    return this.branchRolePermissions.getForBranchRole(
      tenantId,
      branchId,
      authRoleId,
    );
  }

  /** Replace the (branch + role) permission overrides. */
  @Put(':branchId/:authRoleId')
  @Audit({
    module: AuditModule.USER,
    action: AuditAction.UPDATE,
    description: 'Updated branch-role permissions',
  })
  updateForBranchRole(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('branchId') branchId: string,
    @Param('authRoleId') authRoleId: string,
    @Body() dto: UpdateBranchRolePermissionsDto,
  ) {
    this.assertBranchInScope(profile, branchId);
    return this.branchRolePermissions.updateForBranchRole(
      tenantId,
      branchId,
      authRoleId,
      dto,
      actorId,
    );
  }

  /**
   * A branch-scoped caller (Branch Admin — non-null active branch) may only
   * target their own branch. Tenant-level callers (Business Admin — null active
   * branch) may target any branch in the tenant. The branch itself is still
   * validated against the tenant inside the service.
   */
  private assertBranchInScope(profile: ActiveProfile, branchId: string): void {
    if (profile.branchId !== null && profile.branchId !== branchId) {
      throw new BranchScopeViolationException(branchId, profile.branchId);
    }
  }
}
