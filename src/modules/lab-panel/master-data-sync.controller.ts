import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { LabPanelService } from './lab-panel.service';
import { MasterDataImportJobService } from './master-data-import-job.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequireAnyPermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';

/**
 * The Tenant→Branch master-data sync ("Import Master Data" on the branch-admin
 * Master Data page). Lives in the lab-panel module because `LabPanelService`
 * already depends on both `LabTestService` and `MasterDataService` (it sits at
 * the top of the module graph), so it can orchestrate tests + panels without a
 * circular module dependency. The route is namespaced under `/master-data`.
 */
@Controller('master-data/branch')
export class MasterDataSyncController {
  constructor(
    private readonly labPanelService: LabPanelService,
    private readonly importJobService: MasterDataImportJobService,
  ) {}

  /**
   * Sync the tenant's Tenant Master Data into the caller's active Branch Master
   * Data (full overwrite of tests + panels). The branch comes from the JWT
   * (`active_branch_id`) — 400 for a tenant-level role with no active branch.
   */
  @Post('import-from-tenant')
  @UseGuards(PermissionGuard)
  @RequireAnyPermission(
    PERMISSION_KEYS.BR_MD_IMPORT_TESTS,
    PERMISSION_KEYS.BR_MD_IMPORT_PANELS,
  )
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

  /**
   * Same import as `POST import-from-tenant`, run as a background job: returns
   * 202 with the job straight away; poll `GET import-from-tenant/jobs/:jobId`
   * for live progress (100-test batches) and the final result. Still one atomic
   * transaction — a failure saves nothing. 409
   * `MASTER_DATA_IMPORT_ALREADY_RUNNING` while another import runs for this
   * tenant (attach via `GET import-from-tenant/jobs/active`).
   */
  @Post('import-from-tenant/jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(PermissionGuard)
  @RequireAnyPermission(
    PERMISSION_KEYS.BR_MD_IMPORT_TESTS,
    PERMISSION_KEYS.BR_MD_IMPORT_PANELS,
  )
  @Audit({
    module: AuditModule.MASTER_DATA,
    action: AuditAction.UPDATE,
    description: 'Started importing Tenant Master Data into the branch',
  })
  startImportJob(
    @CurrentTenant() tenantId: string,
    @CurrentUser('active_branch_id') branchId: string | null,
    @CurrentUser('person_id') personId: string,
  ) {
    return this.importJobService.start(
      tenantId,
      this.requireBranch(branchId),
      personId,
    );
  }

  /** The active branch's running import, or `null` (re-attach after reload). */
  @Get('import-from-tenant/jobs/active')
  @UseGuards(PermissionGuard)
  @RequireAnyPermission(
    PERMISSION_KEYS.BR_MD_IMPORT_TESTS,
    PERMISSION_KEYS.BR_MD_IMPORT_PANELS,
  )
  getActiveImportJob(
    @CurrentTenant() tenantId: string,
    @CurrentUser('active_branch_id') branchId: string | null,
  ) {
    return this.importJobService.getActive(
      tenantId,
      this.requireBranch(branchId),
    );
  }

  /** One import job of the active branch: live progress, then result or error. */
  @Get('import-from-tenant/jobs/:jobId')
  @UseGuards(PermissionGuard)
  @RequireAnyPermission(
    PERMISSION_KEYS.BR_MD_IMPORT_TESTS,
    PERMISSION_KEYS.BR_MD_IMPORT_PANELS,
  )
  getImportJob(
    @CurrentTenant() tenantId: string,
    @CurrentUser('active_branch_id') branchId: string | null,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.importJobService.get(
      jobId,
      tenantId,
      this.requireBranch(branchId),
    );
  }

  private requireBranch(branchId: string | null): string {
    if (!branchId) {
      throw new BadRequestException('No active branch in the current context');
    }
    return branchId;
  }
}
