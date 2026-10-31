import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { AuditAction, AuditModule, BranchListSyncKind } from '@prisma/client';
import { BranchListSyncJobService } from './branch-list-sync-job.service';
import { StartBranchListSyncJobDto } from './dto/start-branch-list-sync-job.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Background "Sync from Master Data" for the branch **Lab Panel List**
 * (`/branch-lab-panels/sync/jobs`). Mirrors the synchronous `POST
 * /branch-lab-panels/sync` but runs as a polled job so the branch-admin dialog can
 * show live progress (add/update/delete) — see {@link BranchListSyncJobService}.
 * Business-authenticated; tenant + active branch come from the JWT (never the body).
 */
@Controller('branch-lab-panels/sync')
export class BranchLabPanelSyncController {
  constructor(private readonly syncJobService: BranchListSyncJobService) {}

  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Start a background sync of the active branch's Lab Panel List; returns 202 with
   * the job. Poll `GET sync/jobs/:jobId` for live progress + the final result. 409
   * `BRANCH_LIST_SYNC_ALREADY_RUNNING` if one is already running for this branch's
   * panel list (attach via `GET sync/jobs/active`).
   */
  @Post('jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Started syncing branch lab panels from master data',
  })
  start(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: StartBranchListSyncJobDto,
  ) {
    return this.syncJobService.start(
      tenantId,
      this.requireBranch(profile),
      personId,
      BranchListSyncKind.LAB_PANEL,
      dto.listId,
    );
  }

  /** The active branch's running panel-list sync, or `null` (re-attach after reload). */
  @Get('jobs/active')
  getActive(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.syncJobService.getActive(
      tenantId,
      this.requireBranch(profile),
      BranchListSyncKind.LAB_PANEL,
    );
  }

  /** One panel-list sync job of the active branch: live progress, then result/error. */
  @Get('jobs/:jobId')
  get(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.syncJobService.get(
      jobId,
      tenantId,
      this.requireBranch(profile),
    );
  }
}
