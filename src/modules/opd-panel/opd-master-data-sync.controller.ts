import { BadRequestException, Controller, Post } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { OpdPanelService } from './opd-panel.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * The Tenant→Branch opd master-data sync ("Import Master Data" on the
 * branch-admin page). Lives in the opd-panel module because
 * `OpdPanelService` already depends on both `OpdTestService` and
 * `OpdMasterDataService`, so it can orchestrate tests + panels without a
 * circular module dependency. Namespaced under `/opd-master-data`.
 */
@Controller('opd-master-data/branch')
export class OpdMasterDataSyncController {
  constructor(private readonly opdPanelService: OpdPanelService) {}

  /**
   * Sync the tenant's Tenant Opd Master Data into the caller's active Branch
   * Opd Master Data (full overwrite of tests + panels). The branch comes from
   * the JWT (`active_branch_id`) — 400 for a tenant-level role with no active branch.
   */
  @Post('import-from-tenant')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Imported Tenant Opd Master Data into the branch',
  })
  importFromTenant(
    @CurrentTenant() tenantId: string,
    @CurrentUser('active_branch_id') branchId: string | null,
    @CurrentUser('person_id') personId: string,
  ) {
    if (!branchId) {
      throw new BadRequestException('No active branch in the current context');
    }
    return this.opdPanelService.syncTenantToBranch(
      tenantId,
      branchId,
      personId,
    );
  }
}
