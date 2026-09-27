import { BadRequestException, Controller, Post } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { RadiologyPanelService } from './radiology-panel.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * The Tenant→Branch radiology master-data sync ("Import Master Data" on the
 * branch-admin page). Lives in the radiology-panel module because
 * `RadiologyPanelService` already depends on both `RadiologyTestService` and
 * `RadiologyMasterDataService`, so it can orchestrate tests + panels without a
 * circular module dependency. Namespaced under `/radiology-master-data`.
 */
@Controller('radiology-master-data/branch')
export class RadiologyMasterDataSyncController {
  constructor(private readonly radiologyPanelService: RadiologyPanelService) {}

  /**
   * Sync the tenant's Tenant Radiology Master Data into the caller's active Branch
   * Radiology Master Data (full overwrite of tests + panels). The branch comes from
   * the JWT (`active_branch_id`) — 400 for a tenant-level role with no active branch.
   */
  @Post('import-from-tenant')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.UPDATE,
    description: 'Imported Tenant Radiology Master Data into the branch',
  })
  importFromTenant(
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
