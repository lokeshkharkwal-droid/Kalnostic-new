import { BadRequestException, Controller, Post } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { LabPanelService } from './lab-panel.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * The Tenant→Branch master-data sync ("Import Master Data" on the branch-admin
 * Master Data page). Lives in the lab-panel module because `LabPanelService`
 * already depends on both `LabTestService` and `MasterDataService` (it sits at
 * the top of the module graph), so it can orchestrate tests + panels without a
 * circular module dependency. The route is namespaced under `/master-data`.
 */
@Controller('master-data/branch')
export class MasterDataSyncController {
  constructor(private readonly labPanelService: LabPanelService) {}

  /**
   * Sync the tenant's Tenant Master Data into the caller's active Branch Master
   * Data (full overwrite of tests + panels). The branch comes from the JWT
   * (`active_branch_id`) — 400 for a tenant-level role with no active branch.
   */
  @Post('import-from-tenant')
  @Audit({
    module: AuditModule.MASTER_DATA,
    action: AuditAction.UPDATE,
    description: 'Imported Tenant Master Data into the branch',
  })
  importFromTenant(
    @CurrentTenant() tenantId: string,
    @CurrentUser('active_branch_id') branchId: string | null,
    @CurrentUser('person_id') personId: string,
  ) {
    if (!branchId) {
      throw new BadRequestException('No active branch in the current context');
    }
    return this.labPanelService.syncTenantToBranch(
      tenantId,
      branchId,
      personId,
    );
  }
}
