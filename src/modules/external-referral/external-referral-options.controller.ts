import { Controller, Get, Query } from '@nestjs/common';
import { ExternalReferralService } from './external-referral.service';
import { ExternalReferralOptionsQueryDto } from './dto/external-referral-options-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

/**
 * Flat external-referral options endpoint (`/external-referrals/options`),
 * separate from the CRUD controller. Business-authenticated; tenant comes from
 * the JWT. The global `JwtAuthGuard` protects all routes.
 */
@Controller('external-referrals')
export class ExternalReferralOptionsController {
  constructor(
    private readonly externalReferralService: ExternalReferralService,
  ) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector. Filters to
   * the tenant's external referrals, optionally by a name `search`. Returns the
   * full array when `page` is omitted, or a paginated envelope when `page` is
   * supplied.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: ExternalReferralOptionsQueryDto,
  ) {
    return this.externalReferralService.findOptions(tenantId, {
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }
}
