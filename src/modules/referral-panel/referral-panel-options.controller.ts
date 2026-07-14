import { Controller, Get, Query } from '@nestjs/common';
import { ReferralPanelService } from './referral-panel.service';
import { ReferralPanelOptionsQueryDto } from './dto/referral-panel-options-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

/**
 * Flat referral-panel options endpoint (`/referral-panels/options`), separate
 * from the CRUD controller. Business-authenticated; tenant comes from the JWT.
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('referral-panels')
export class ReferralPanelOptionsController {
  constructor(private readonly referralPanelService: ReferralPanelService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector. Filters to
   * the tenant's active referral panels, optionally by a name `search` and a
   * `branchId` (strict branch scope). Returns the full array when `page` is
   * omitted, or a paginated envelope when `page` is supplied.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: ReferralPanelOptionsQueryDto,
  ) {
    return this.referralPanelService.findOptions(tenantId, {
      search: query.search,
      branchId: query.branchId,
      page: query.page,
      limit: query.limit,
    });
  }
}
