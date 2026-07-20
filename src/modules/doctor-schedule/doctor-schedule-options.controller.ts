import { Controller, Get, Query } from '@nestjs/common';
import { DoctorListService } from './doctor-list.service';
import { DoctorsService } from '../doctors/doctors.service';
import { BranchService } from '../branch/branch.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { DoctorOptionsQueryDto } from '../doctors/dto/doctor-options-query.dto';

/**
 * Master dropdown options for the Doctor Schedule screens. Business-
 * authenticated; tenant comes from the JWT. Each returns **active-only**
 * `{ id, name }[]`, delegating to the owning module's service where one exists
 * (doctors, branches) and to `DoctorListService` for department/speciality.
 */
@Controller('doctor-schedules/options')
export class DoctorScheduleOptionsController {
  constructor(
    private readonly doctorListService: DoctorListService,
    private readonly doctorsService: DoctorsService,
    private readonly branchService: BranchService,
  ) {}

  /** CONSULTANT doctor options (optionally filtered by branch / name search). */
  @Get('doctors')
  doctors(
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

  /** Branch options for the tenant. */
  @Get('branches')
  branches(@CurrentTenant() tenantId: string) {
    return this.branchService.findOptionsForTenant(tenantId);
  }

  /** Active department options for the tenant. */
  @Get('departments')
  departments(@CurrentTenant() tenantId: string) {
    return this.doctorListService.departmentOptions(tenantId);
  }

  /** Active speciality (category) options for the tenant. */
  @Get('specialities')
  specialities(@CurrentTenant() tenantId: string) {
    return this.doctorListService.specialityOptions(tenantId);
  }
}
