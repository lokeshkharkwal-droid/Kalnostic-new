import { Controller, Get, Query } from '@nestjs/common';
import { PhlebotomistListService } from './phlebotomist-list.service';
import { ListSchedulePhlebotomistsDto } from './dto/list-schedule-phlebotomists.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { ActiveBranchRequiredException } from './exceptions/phlebotomist-schedule.exceptions';

/**
 * Phlebotomist List (Tab 1) endpoint. Business-authenticated; tenant + active
 * branch come from the JWT. Registered before the `:id` route of the schedule
 * controller so the static `phlebotomists` segment isn't captured as an id.
 */
@Controller('phlebotomist-schedules')
export class PhlebotomistListController {
  constructor(
    private readonly phlebotomistListService: PhlebotomistListService,
  ) {}

  /** Ensure the caller has an active branch, or throw. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Paginated list of the active branch's phlebotomists with dynamic
   * assigned/completed/phlebotomy counts and current status. Supports search,
   * zone/status filters, and sorting.
   */
  @Get('phlebotomists')
  list(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListSchedulePhlebotomistsDto,
  ) {
    return this.phlebotomistListService.list(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }
}
