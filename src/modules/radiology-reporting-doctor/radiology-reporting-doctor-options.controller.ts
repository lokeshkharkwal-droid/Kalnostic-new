import { Controller, Get, Query } from '@nestjs/common';
import { RadiologyReportingDoctorService } from './radiology-reporting-doctor.service';
import { RadiologyReportingDoctorOptionsQueryDto } from './dto/radiology-reporting-doctor-options-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

/**
 * Flat radiology reporting-doctor options endpoint
 * (`/radiology-reporting-doctors/options`), separate from the CRUD controller.
 * Business-authenticated; tenant comes from the JWT. The global `JwtAuthGuard`
 * protects all routes.
 */
@Controller('radiology-reporting-doctors')
export class RadiologyReportingDoctorOptionsController {
  constructor(
    private readonly radiologyReportingDoctorService: RadiologyReportingDoctorService,
  ) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector. Filters to the
   * tenant's reporting doctors, optionally by `branchId` and a name `search`.
   * Returns the full array when `page` is omitted, or a paginated envelope when
   * `page` is supplied.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: RadiologyReportingDoctorOptionsQueryDto,
  ) {
    return this.radiologyReportingDoctorService.findOptions(tenantId, {
      branchId: query.branchId,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }
}
