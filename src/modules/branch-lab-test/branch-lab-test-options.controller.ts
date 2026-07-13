import { Controller, Get, Query } from '@nestjs/common';
import { BranchLabTestService } from './branch-lab-test.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { BranchLabTestOptionsQueryDto } from './dto/branch-lab-test-options-query.dto';
import { ActiveBranchRequiredException } from './exceptions/branch-lab-test.exceptions';

/**
 * Branch Lab Test **options** endpoint (`GET /branch-lab-tests/options`) — a
 * lightweight `{ id, name }` selector for the Create-Order lab-test picker.
 * Separate from the CRUD controller (mirrors the lab-test module's split).
 * Business-authenticated; tenant from the JWT (`@CurrentTenant`) and the active
 * branch from the JWT profile (`@CurrentProfile`) — never the body (CLAUDE.md §4.7).
 */
@Controller('branch-lab-tests')
export class BranchLabTestOptionsController {
  constructor(private readonly branchLabTestService: BranchLabTestService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Lightweight `{ id, name }` options for the searchable selector — the active
   * branch's active default-variant lab tests, optionally filtered by `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchLabTestOptionsQueryDto,
  ) {
    return this.branchLabTestService.findOptions(
      tenantId,
      this.requireBranch(profile),
      { search: query.search, page: query.page, limit: query.limit },
    );
  }
}
