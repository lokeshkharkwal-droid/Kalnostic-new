import { Controller, Get, Query } from '@nestjs/common';
import { DoctorListService } from './doctor-list.service';
import { ListScheduleDoctorsDto } from './dto/list-schedule-doctors.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

/**
 * Doctor List (Tab 1) endpoint. Business-authenticated; tenant comes from the
 * JWT. Registered before the `:id` route of the schedule controller so the
 * static `doctors` segment isn't captured as an id.
 */
@Controller('doctor-schedules')
export class DoctorListController {
  constructor(private readonly doctorListService: DoctorListService) {}

  /**
   * Paginated list of CONSULTANT doctors with dynamic assigned/completed
   * appointment counts and current status. Supports search, branch/department/
   * speciality/status filters, and sorting.
   */
  @Get('doctors')
  list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListScheduleDoctorsDto,
  ) {
    return this.doctorListService.list(tenantId, query);
  }
}
