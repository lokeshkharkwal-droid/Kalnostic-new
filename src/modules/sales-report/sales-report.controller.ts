import { Controller, Get, Query } from '@nestjs/common';
import { SalesReportService } from './sales-report.service';
import { SalesReportQueryDto } from './dto/sales-report-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { ActiveBranchRequiredException } from './exceptions/sales-report.exceptions';

/**
 * Sales reporting endpoints (business-authenticated; tenant + active branch come
 * from the JWT). Powers the Sales → Reports section (Lead-wise + Salesperson-wise
 * tables). Read-only — no `@Audit` on GETs.
 */
@Controller('sales/reports')
export class SalesReportController {
  constructor(private readonly reportService: SalesReportService) {}

  /** Ensure the caller has an active branch, or throw. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** Lead-wise report: one flat row per lead (with filters). */
  @Get('lead-wise')
  leadWise(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: SalesReportQueryDto,
  ) {
    return this.reportService.leadWise(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /** Salesperson-wise report: per-salesperson aggregates (with filters). */
  @Get('salesperson-wise')
  salespersonWise(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: SalesReportQueryDto,
  ) {
    return this.reportService.salespersonWise(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }
}
