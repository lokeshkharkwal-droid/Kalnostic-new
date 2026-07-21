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
import { ServiceZoneService } from './service-zone.service';
import { CreateServiceZoneDto } from './dto/create-service-zone.dto';
import { UpdateServiceZoneDto } from './dto/update-service-zone.dto';
import { ListServiceZonesDto } from './dto/list-service-zones.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ActiveBranchRequiredException } from './exceptions/phlebotomist-schedule.exceptions';

/**
 * Service area / zone master (branch-scoped). Business-authenticated; tenant +
 * active branch come from the JWT (CLAUDE.md §4.7). Powers the "Area / Zone"
 * dropdown used by the phlebotomist Configure form.
 */
@Controller('service-zones')
export class ServiceZoneController {
  constructor(private readonly serviceZoneService: ServiceZoneService) {}

  /** Ensure the caller has an active branch, or throw. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** List the active branch's service zones (paginated + search + status). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListServiceZonesDto,
  ) {
    return this.serviceZoneService.findAll(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /** Fetch one service zone by id. */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.serviceZoneService.findById(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Create a service zone at the active branch. */
  @Post()
  @Audit({
    module: AuditModule.SERVICE_ZONE,
    action: AuditAction.CREATE,
    description: 'Created a service zone',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateServiceZoneDto,
  ) {
    return this.serviceZoneService.create(
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Update a service zone. */
  @Patch(':id')
  @Audit({
    module: AuditModule.SERVICE_ZONE,
    action: AuditAction.UPDATE,
    description: 'Updated a service zone',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateServiceZoneDto,
  ) {
    return this.serviceZoneService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Soft-delete a service zone. */
  @Delete(':id')
  @Audit({
    module: AuditModule.SERVICE_ZONE,
    action: AuditAction.DELETE,
    description: 'Deleted a service zone',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.serviceZoneService.remove(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }
}
