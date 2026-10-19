import { Controller, Get, Query } from '@nestjs/common';
import { BranchRadiologyTestService } from './branch-radiology-test.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { BranchRadiologyTestOptionsQueryDto } from './dto/branch-radiology-test-options-query.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Branch Radiology Test **options** endpoint
 * (`GET /branch-radiology-tests/options`) — a lightweight selector for the
 * Create-Order radiology-test picker. Separate from the CRUD controller (mirrors
 * the branch-lab-test module's split). Business-authenticated; tenant from the
 * JWT (`@CurrentTenant`) and the active branch from the JWT profile
 * (`@CurrentProfile`) — never the body (CLAUDE.md §4.7).
 */
@Controller('branch-radiology-tests')
export class BranchRadiologyTestOptionsController {
  constructor(private readonly service: BranchRadiologyTestService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Lightweight options for the searchable selector — the active branch's active
   * default-variant radiology tests, optionally filtered by `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchRadiologyTestOptionsQueryDto,
  ) {
    return this.service.findOptions(tenantId, this.requireBranch(profile), {
      search: query.search,
      page: query.page,
      limit: query.limit,
      listId: query.listId,
      preferredOnly: query.preferredOnly,
    });
  }
}
