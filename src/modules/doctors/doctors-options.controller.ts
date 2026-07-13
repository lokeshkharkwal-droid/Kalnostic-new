import { Controller, Get, Query } from '@nestjs/common';
import { DoctorsService } from './doctors.service';
import { DoctorOptionsQueryDto } from './dto/doctor-options-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

/**
 * Flat doctor options endpoint (`/doctors/options`), separate from the CRUD
 * controller. Business-authenticated; tenant comes from the JWT. The global
 * `JwtAuthGuard` protects all routes.
 */
@Controller('doctors')
export class DoctorsOptionsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector. Filters to
   * the tenant's CONSULTANT doctors, optionally by `branchId` and a name
   * `search`. Returns the full array when `page` is omitted, or a paginated
   * envelope when `page` is supplied.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: DoctorOptionsQueryDto,
  ) {
    return this.doctorsService.findOptions(tenantId, {
      branchId: query.branchId,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }
}
