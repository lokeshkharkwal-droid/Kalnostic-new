import {
  BadRequestException,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { RadiologyPanelService } from './radiology-panel.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequireAnyPermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';

/**
 * The Tenant→Branch radiology master-data sync ("Import Master Data" on the
 * branch-admin Radiology Master Data page). The radiology twin of
 * `MasterDataSyncController` (lab); lives in the radiology-panel module because
 * `RadiologyPanelService` already depends on both `RadiologyTestService` and
 * `MasterDataService`, so it can orchestrate tests + panels without a circular
 * module dependency. The route is namespaced under `/master-data`.
 */
@Controller('master-data/branch')
export class RadiologyMasterDataSyncController {
  constructor(private readonly radiologyPanelService: RadiologyPanelService) {}

  /**
   * Sync the tenant's Tenant Master Data radiology tests + panels into the
   * caller's active Branch Master Data (full overwrite). The branch comes from
   * the JWT (`active_branch_id`) — 400 for a tenant-level role with no active
   * branch. Reuses the lab Master-Data import permissions (no radiology-specific
   * keys exist; business routes don't yet enforce route-level RBAC per CLAUDE.md).
   */
  @Post('import-radiology-from-tenant')
  @UseGuards(PermissionGuard)
  @RequireAnyPermission(
    PERMISSION_KEYS.BR_MD_IMPORT_TESTS,
    PERMISSION_KEYS.BR_MD_IMPORT_PANELS,
  )
  @Audit({
    module: AuditModule.MASTER_DATA,
    action: AuditAction.UPDATE,
    description: 'Imported Tenant Master Data radiology into the branch',
  })
  importRadiologyFromTenant(
    @CurrentTenant() tenantId: string,
    @CurrentUser('active_branch_id') branchId: string | null,
    @CurrentUser('person_id') personId: string,
  ) {
    if (!branchId) {
      throw new BadRequestException('No active branch in the current context');
    }
    return this.radiologyPanelService.syncTenantToBranch(
      tenantId,
      branchId,
      personId,
    );
  }
}
