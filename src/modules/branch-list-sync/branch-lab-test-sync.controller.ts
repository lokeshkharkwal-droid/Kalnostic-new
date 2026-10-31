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
 * Background "Sync from Master Data" for the branch **Lab Test List**
 * (`/branch-lab-tests/sync/jobs`). Mirrors the synchronous `POST
 * /branch-lab-tests/sync` but runs as a polled job so the branch-admin dialog can
 * show live progress (add/update/delete) — see {@link BranchListSyncJobService}.
 * Business-authenticated; tenant + active branch come from the JWT (never the body).
 * Lives in its own module so it can inject both branch-list services without a cycle.
 */
@Controller('branch-lab-tests/sync')
export class BranchLabTestSyncController {
  constructor(private readonly syncJobService: BranchListSyncJobService) {}

  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Start a background sync of the active branch's Lab Test List; returns 202 with
   * the job. Poll `GET sync/jobs/:jobId` for live progress + the final result. 409
   * `BRANCH_LIST_SYNC_ALREADY_RUNNING` if one is already running for this branch's
   * test list (attach via `GET sync/jobs/active`).
   */
  @Post('jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Started syncing branch lab tests from master data',
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
      BranchListSyncKind.LAB_TEST,
      dto.listId,
    );
  }

  /** The active branch's running test-list sync, or `null` (re-attach after reload). */
  @Get('jobs/active')
  getActive(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.syncJobService.getActive(
      tenantId,
      this.requireBranch(profile),
      BranchListSyncKind.LAB_TEST,
    );
  }

  /** One test-list sync job of the active branch: live progress, then result/error. */
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
