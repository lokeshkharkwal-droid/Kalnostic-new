import { Controller, Get, Query } from '@nestjs/common';
import { PhlebotomistService } from './phlebotomist.service';
import { PhlebotomistOptionsQueryDto } from './dto/phlebotomist-options-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

/**
 * Flat phlebotomist options endpoint (`/phlebotomists/options`), separate from
 * the CRUD controller. Business-authenticated; tenant comes from the JWT. The
 * global `JwtAuthGuard` protects all routes.
 */
@Controller('phlebotomists')
export class PhlebotomistOptionsController {
  constructor(private readonly phlebotomistService: PhlebotomistService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector. Filters to
   * the tenant's phlebotomists, optionally by `branchId` and a name `search`.
   * Returns the full array when `page` is omitted, or a paginated envelope when
   * `page` is supplied.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: PhlebotomistOptionsQueryDto,
  ) {
    return this.phlebotomistService.findOptions(tenantId, {
      branchId: query.branchId,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }
}
