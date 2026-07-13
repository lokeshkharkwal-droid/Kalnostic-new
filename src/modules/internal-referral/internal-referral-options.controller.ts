import { Controller, Get, Query } from '@nestjs/common';
import { InternalReferralService } from './internal-referral.service';
import { InternalReferralOptionsQueryDto } from './dto/internal-referral-options-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

/**
 * Flat internal-referral options endpoint (`/internal-referrals/options`),
 * separate from the CRUD controller. Business-authenticated; tenant comes from
 * the JWT. The global `JwtAuthGuard` protects all routes.
 */
@Controller('internal-referrals')
export class InternalReferralOptionsController {
  constructor(
    private readonly internalReferralService: InternalReferralService,
  ) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector. Filters to
   * the tenant's internal referrals, optionally by a name `search`. Returns the
   * full array when `page` is omitted, or a paginated envelope when `page` is
   * supplied.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: InternalReferralOptionsQueryDto,
  ) {
    return this.internalReferralService.findOptions(tenantId, {
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }
}
