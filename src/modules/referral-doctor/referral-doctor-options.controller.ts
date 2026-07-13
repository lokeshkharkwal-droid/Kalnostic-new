import { Controller, Get, Query } from '@nestjs/common';
import { ReferralDoctorService } from './referral-doctor.service';
import { ReferralDoctorOptionsQueryDto } from './dto/referral-doctor-options-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

/**
 * Flat referral-doctor options endpoint (`/referral-doctors/options`), separate
 * from the CRUD controller. Business-authenticated; tenant comes from the JWT.
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('referral-doctors')
export class ReferralDoctorOptionsController {
  constructor(private readonly referralDoctorService: ReferralDoctorService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector. Filters to
   * the tenant's referral doctors, optionally by a name `search`. Returns the
   * full array when `page` is omitted, or a paginated envelope when `page` is
   * supplied.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: ReferralDoctorOptionsQueryDto,
  ) {
    return this.referralDoctorService.findOptions(tenantId, {
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }
}
