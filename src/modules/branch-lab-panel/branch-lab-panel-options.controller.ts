import { Controller, Get, Param, Query } from '@nestjs/common';
import { BranchLabPanelService } from './branch-lab-panel.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { BranchLabPanelOptionsQueryDto } from './dto/branch-lab-panel-options-query.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Branch Lab Panel **options** endpoint (`GET /branch-lab-panels/options`) — a
 * lightweight `{ id, name, price, sampleType, isFasting }` selector for the
 * Create-Order lab-panel picker.
 * Separate from the CRUD controller (mirrors the lab-panel module's split).
 * Business-authenticated; tenant from the JWT (`@CurrentTenant`) and the active
 * branch from the JWT profile (`@CurrentProfile`) — never the body (CLAUDE.md §4.7).
 */
@Controller('branch-lab-panels')
export class BranchLabPanelOptionsController {
  constructor(private readonly branchLabPanelService: BranchLabPanelService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Lightweight `{ id, name, price, sampleType, isFasting }` options for the
   * searchable selector — the active branch's active default-variant panels,
   * optionally filtered by `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchLabPanelOptionsQueryDto,
  ) {
    return this.branchLabPanelService.findOptions(
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

  /**
   * The member tests of one branch lab panel + its partial-billing controls —
   * `GET /branch-lab-panels/:id/member-tests`. Powers the Create-Order Diagnostic
   * Items table's expandable panel row (each member shows its own sample name /
   * schedule / fasting / STAT / schedule days, with a de-select checkbox gated by
   * `isRemovable` + the panel's `isAllowPartialBilling`/`maxTestsRemovable`). The
   * active branch is resolved from the JWT profile — never the body.
   */
  @Get(':id/member-tests')
  findMemberTests(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.branchLabPanelService.findMemberTests(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }
}
