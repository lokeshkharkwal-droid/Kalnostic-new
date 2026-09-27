import { Controller, Get, Query } from '@nestjs/common';
import { BranchOpdTestService } from './branch-opd-test.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { BranchOpdTestOptionsQueryDto } from './dto/branch-opd-test-options-query.dto';
import { ActiveBranchRequiredException } from './exceptions/branch-opd-test.exceptions';

/**
 * Branch Opd Test **options** endpoint
 * (`GET /branch-opd-tests/options`) — a lightweight selector for the
 * Create-Order opd-test picker. Separate from the CRUD controller (mirrors
 * the opd-test module's split). Tenant from `@CurrentTenant`, active branch
 * from `@CurrentProfile` — never the body (CLAUDE.md §4.7).
 */
@Controller('branch-opd-tests')
export class BranchOpdTestOptionsController {
  constructor(private readonly branchOpdTestService: BranchOpdTestService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Lightweight options for the searchable selector — the active branch's active
   * default-variant opd tests, optionally filtered by `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchOpdTestOptionsQueryDto,
  ) {
    return this.branchOpdTestService.findOptions(
      tenantId,
      this.requireBranch(profile),
      {
        search: query.search,
        page: query.page,
        limit: query.limit,
        listId: query.listId,
        preferredOnly: query.preferredOnly,
      },
    );
  }
}
