import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { SalesTripService } from './sales-trip.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { UpdateTripStatusDto } from './dto/update-trip-status.dto';
import { ListTripsDto } from './dto/list-trips.dto';
import { TripVisitDto } from './dto/trip-visit.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ActiveBranchRequiredException } from './exceptions/sales-trip.exceptions';

/**
 * Field-sales trip endpoints (business-authenticated; tenant + active branch come
 * from the JWT). Powers the Sales → Trips section (list, overview, roadmap,
 * status, visits) and the priority create-trip POST.
 */
@Controller('sales/trips')
export class SalesTripController {
  constructor(private readonly tripService: SalesTripService) {}

  /** Ensure the caller has an active branch, or throw. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** List the active branch's trips (paginated + filters). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListTripsDto,
  ) {
    return this.tripService.findAll(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /** Create a field-sales trip at the active branch (priority endpoint). */
  @Post()
  @Audit({
    module: AuditModule.SALES_TRIP,
    action: AuditAction.CREATE,
    description: 'Created a sales trip',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateTripDto,
  ) {
    return this.tripService.create(
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Fetch one trip (with visits + derived counts). */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.tripService.findById(id, tenantId, this.requireBranch(profile));
  }

  /** Roadmap view (ordered visits + start/end waypoints + totals). */
  @Get(':id/roadmap')
  roadmap(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.tripService.roadmap(id, tenantId, this.requireBranch(profile));
  }

  /** Update a trip's own fields. */
  @Patch(':id')
  @Audit({
    module: AuditModule.SALES_TRIP,
    action: AuditAction.UPDATE,
    description: 'Updated a sales trip',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTripDto,
  ) {
    return this.tripService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Transition a trip's status (Planned → In Progress → Completed / Cancelled). */
  @Patch(':id/status')
  @Audit({
    module: AuditModule.SALES_TRIP,
    action: AuditAction.UPDATE,
    description: 'Updated a sales trip status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTripStatusDto,
  ) {
    return this.tripService.updateStatus(
      id,
      tenantId,
      this.requireBranch(profile),
      dto.status,
      personId,
    );
  }

  /** Soft-delete a trip. */
  @Delete(':id')
  @Audit({
    module: AuditModule.SALES_TRIP,
    action: AuditAction.DELETE,
    description: 'Deleted a sales trip',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.tripService.remove(id, tenantId, this.requireBranch(profile));
  }

  /** Add a visit/waypoint to a trip. */
  @Post(':id/visits')
  @Audit({
    module: AuditModule.SALES_TRIP,
    action: AuditAction.UPDATE,
    description: 'Added a sales trip visit',
  })
  addVisit(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: TripVisitDto,
  ) {
    return this.tripService.addVisit(
      id,
      tenantId,
      this.requireBranch(profile),
      dto,
    );
  }

  /** Update a visit/waypoint on a trip. */
  @Patch(':id/visits/:visitId')
  @Audit({
    module: AuditModule.SALES_TRIP,
    action: AuditAction.UPDATE,
    description: 'Updated a sales trip visit',
  })
  updateVisit(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Param('visitId') visitId: string,
    @Body() dto: TripVisitDto,
  ) {
    return this.tripService.updateVisit(
      id,
      visitId,
      tenantId,
      this.requireBranch(profile),
      dto,
    );
  }
}
