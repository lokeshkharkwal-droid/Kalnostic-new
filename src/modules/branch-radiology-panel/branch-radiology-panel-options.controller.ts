import { Controller, Get, Query } from '@nestjs/common';
import { BranchRadiologyPanelService } from './branch-radiology-panel.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { BranchRadiologyPanelOptionsQueryDto } from './dto/branch-radiology-panel-options-query.dto';
import { ActiveBranchRequiredException } from '../branch-radiology-test/exceptions/branch-radiology-test.exceptions';

/**
 * Branch Radiology Panel **options** endpoint
 * (`GET /branch-radiology-panels/options`) — a lightweight selector for the
 * Create-Order radiology-panel picker. Separate from the CRUD controller. Tenant
 * from `@CurrentTenant`, active branch from `@CurrentProfile` — never the body.
 */
@Controller('branch-radiology-panels')
export class BranchRadiologyPanelOptionsController {
  constructor(
    private readonly branchRadiologyPanelService: BranchRadiologyPanelService,
  ) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Lightweight options for the searchable selector — the active branch's active
   * default-variant radiology panels, optionally filtered by `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchRadiologyPanelOptionsQueryDto,
  ) {
    return this.branchRadiologyPanelService.findOptions(
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
