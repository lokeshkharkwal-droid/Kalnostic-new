import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PhlebotomistCollectionService } from './phlebotomist-collection.service';
import { ListCollectionsDto } from './dto/list-collections.dto';
import { UpdateCollectionStatusDto } from './dto/update-collection-status.dto';
import { RescheduleCollectionDto } from './dto/reschedule-collection.dto';
import { CollectionSummaryQueryDto } from './dto/collection-summary-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Phlebotomist home sample-collection endpoints (the Collection Schedule, its
 * dashboard summary and reports). Business-authenticated; tenant from the JWT and
 * branch from the active profile (global `JwtAuthGuard`). Writes are audited under
 * `AuditModule.PHLEBOTOMIST`.
 *
 * The static `summary` / `reports/*` routes are declared before `:id` so they
 * match ahead of the id param route.
 */
@Controller('phlebotomist-collections')
export class PhlebotomistCollectionController {
  constructor(private readonly service: PhlebotomistCollectionService) {}

  /** List collections for the Collection Schedule (paginated, filterable). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListCollectionsDto,
  ) {
    return this.service.findAll(tenantId, profile.branchId, query);
  }

  /** Dashboard summary (totals, per-status, per-phlebotomist, per-day, charges). */
  @Get('summary')
  summary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: CollectionSummaryQueryDto,
  ) {
    return this.service.summary(tenantId, profile.branchId, query);
  }

  /** Patient-wise report (enriched collection rows + report filters + pagination). */
  @Get('reports/patient-wise')
  patientWiseReport(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListCollectionsDto,
  ) {
    return this.service.patientWiseReport(tenantId, profile.branchId, query);
  }

  /** Phlebotomist-wise report (per-phlebotomist rollups). */
  @Get('reports/phlebotomist-wise')
  phlebotomistWiseReport(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: CollectionSummaryQueryDto,
  ) {
    return this.service.phlebotomistWiseReport(
      tenantId,
      profile.branchId,
      query,
    );
  }

  /** Fetch one collection with its status history (Collection Overview). */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findById(id, tenantId);
  }

  /** Set a collection to a new status (unrestricted; cascaded). */
  @Patch(':id/status')
  @Audit({
    module: AuditModule.PHLEBOTOMIST,
    action: AuditAction.UPDATE,
    description: 'Updated a home-visit collection status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCollectionStatusDto,
  ) {
    return this.service.updateStatus(id, tenantId, personId, dto);
  }

  /** Reschedule a collection (re-reserves the phlebotomist slot). */
  @Patch(':id/reschedule')
  @Audit({
    module: AuditModule.PHLEBOTOMIST,
    action: AuditAction.UPDATE,
    description: 'Rescheduled a home-visit collection',
  })
  reschedule(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RescheduleCollectionDto,
  ) {
    return this.service.reschedule(id, tenantId, personId, dto);
  }
}
