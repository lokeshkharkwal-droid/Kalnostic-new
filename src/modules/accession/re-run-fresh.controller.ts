import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ActiveBranchRequiredException } from '../lab-report/exceptions/lab-report.exceptions';
import { ReRunFreshService } from './re-run-fresh.service';
import {
  ReRunFreshDto,
  ReRunFreshEligibilityDto,
} from './dto/re-run-fresh.dto';

/**
 * Re-run with a fresh sample. Raised from the Technician screen's Re-run dialog, so it needs the same permission as the
 * Re-run button (`LAB_MARK_RE_RUN`); it lives in the Accession module because it moves the test's sample.
 */
@Controller('accession/re-run-fresh')
@UseGuards(PermissionGuard)
export class ReRunFreshController {
  constructor(private readonly reRunFresh: ReRunFreshService) {}

  /**
   * The tests that share the clicked test's tube, each with whether it can be re-run with a fresh sample now (and why not).
   * Feeds the pop-up.
   */
  @Get('eligibility')
  @RequirePermission(PERMISSION_KEYS.LAB_MARK_RE_RUN)
  eligibility(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: ReRunFreshEligibilityDto,
  ) {
    return this.reRunFresh.eligibility(
      tenantId,
      this.requireBranch(profile.branchId),
      query.reportId,
      personId,
    );
  }

  /** Re-run the ticked tests with a fresh sample (all or nothing). */
  @Post()
  @RequirePermission(PERMISSION_KEYS.LAB_MARK_RE_RUN)
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Re-ran lab report(s) with a fresh sample',
  })
  rerunFresh(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ReRunFreshDto,
  ) {
    return this.reRunFresh.rerunFresh(
      tenantId,
      this.requireBranch(profile.branchId),
      personId,
      dto,
    );
  }

  private requireBranch(branchId: string | null): string {
    if (!branchId) throw new ActiveBranchRequiredException();
    return branchId;
  }
}
