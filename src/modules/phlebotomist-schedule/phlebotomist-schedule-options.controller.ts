import { Controller, Get, Query } from '@nestjs/common';
import { PhleboServiceType } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { BranchService } from '../branch/branch.service';
import { ServiceZoneService } from './service-zone.service';
import { PhlebotomistSlotService } from './phlebotomist-slot.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { PhlebotomistOptionsQueryDto } from './dto/phlebotomist-options-query.dto';
import { PhlebotomistAvailabilityQueryDto } from './dto/phlebotomist-availability-query.dto';
import { ActiveBranchRequiredException } from './exceptions/phlebotomist-schedule.exceptions';

/** Human labels for the service-type dropdown (kept in sync with the FE). */
const SERVICE_TYPE_LABELS: Record<PhleboServiceType, string> = {
  HOME_COLLECTION: 'Home Collection',
  IN_CENTER: 'In-Center',
};

/**
 * Master dropdown options for the Phlebotomist Schedule screens. Business-
 * authenticated; tenant + active branch come from the JWT. Each returns
 * active-only records for the caller's branch, delegating to the owning service.
 */
@Controller('phlebotomist-schedules/options')
export class PhlebotomistScheduleOptionsController {
  constructor(
    private readonly usersService: UsersService,
    private readonly serviceZoneService: ServiceZoneService,
    private readonly branchService: BranchService,
    private readonly slotService: PhlebotomistSlotService,
  ) {}

  /** Ensure the caller has an active branch, or throw. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** Active phlebotomist `{ id, name }` options for the branch. */
  @Get('phlebotomists')
  phlebotomists(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: PhlebotomistOptionsQueryDto,
  ) {
    return this.usersService.findPhlebotomistOptions(
      tenantId,
      this.requireBranch(profile),
      { search: query.search, page: query.page, limit: query.limit },
    );
  }

  /**
   * Home-visit availability for a phlebotomist over a date window: which dates
   * are selectable (and why not) plus each date's bookable time slots. Powers the
   * create-order collection date/time picker. Defaults to today → generated horizon.
   */
  @Get('availability')
  availability(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: PhlebotomistAvailabilityQueryDto,
  ) {
    return this.slotService.getAvailability(
      tenantId,
      this.requireBranch(profile),
      query.phlebotomistId,
      query.from,
      query.to,
    );
  }

  /** Active service area/zone `{ id, name }` options for the branch. */
  @Get('zones')
  zones(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.serviceZoneService.options(
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Static service-type `{ value, label }` options. */
  @Get('service-types')
  serviceTypes() {
    return Object.values(PhleboServiceType).map((value) => ({
      value,
      label: SERVICE_TYPE_LABELS[value],
    }));
  }

  /** The caller's active branch (id/name/type) for the Configure form header. */
  @Get('branch')
  branch(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.branchService.findById(this.requireBranch(profile), tenantId);
  }
}
