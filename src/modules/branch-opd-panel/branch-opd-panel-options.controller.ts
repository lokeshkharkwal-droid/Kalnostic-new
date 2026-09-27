import { Controller, Get, Query } from '@nestjs/common';
import { BranchOpdPanelService } from './branch-opd-panel.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { BranchOpdPanelOptionsQueryDto } from './dto/branch-opd-panel-options-query.dto';
import { ActiveBranchRequiredException } from '../branch-opd-test/exceptions/branch-opd-test.exceptions';

/**
 * Branch Opd Panel **options** endpoint
 * (`GET /branch-opd-panels/options`) — a lightweight selector for the
 * Create-Order opd-panel picker. Separate from the CRUD controller. Tenant
 * from `@CurrentTenant`, active branch from `@CurrentProfile` — never the body.
 */
@Controller('branch-opd-panels')
export class BranchOpdPanelOptionsController {
  constructor(private readonly branchOpdPanelService: BranchOpdPanelService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Lightweight options for the searchable selector — the active branch's active
   * default-variant opd panels, optionally filtered by `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchOpdPanelOptionsQueryDto,
  ) {
    return this.branchOpdPanelService.findOptions(
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
