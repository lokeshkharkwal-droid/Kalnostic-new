import {
  UseGuards,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequireAnyPermission } from '../permissions/decorators/require-permission.decorator';
import { ADMIN_KEY_GROUPS } from '../permissions/constants/module-permissions.constant';
import { AuditAction, AuditModule } from '@prisma/client';
import { RadiologyReportingDoctorService } from './radiology-reporting-doctor.service';
import { CreateRadiologyReportingDoctorDto } from './dto/create-radiology-reporting-doctor.dto';
import { ListRadiologyReportingDoctorsDto } from './dto/list-radiology-reporting-doctors.dto';
import { UpdateRadiologyReportingDoctorDto } from './dto/update-radiology-reporting-doctor.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Radiology reporting-doctor registry endpoints (business-authenticated; tenant
 * comes from the JWT; the active branch, when the caller is in a branch profile,
 * also comes from the JWT and scopes every route — tenant-level callers see the
 * whole tenant). The global `JwtAuthGuard` protects all routes. Reuses the
 * doctor permission key groups and the `AuditModule.DOCTOR` audit enum — there are
 * no radiology-reporting-doctor-specific ones.
 */
@Controller('radiology-reporting-doctors')
@UseGuards(PermissionGuard)
export class RadiologyReportingDoctorController {
  constructor(
    private readonly radiologyReportingDoctorService: RadiologyReportingDoctorService,
  ) {}

  /**
   * Register a radiology reporting doctor in the caller's tenant.
   */
  @Post()
  @RequireAnyPermission(...ADMIN_KEY_GROUPS.DOCTOR_ADD)
  @Audit({
    module: AuditModule.DOCTOR,
    action: AuditAction.CREATE,
    description: 'Created a radiology reporting doctor',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: CreateRadiologyReportingDoctorDto,
  ) {
    return this.radiologyReportingDoctorService.create(
      tenantId,
      dto,
      profile.branchId,
    );
  }

  /**
   * List radiology reporting doctors in the caller's tenant (paginated; trimmed
   * fields). Supports `search` (name / reg-no), `departmentId`, `status`,
   * `doctorType`, and `branchId` filters.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListRadiologyReportingDoctorsDto,
  ) {
    return this.radiologyReportingDoctorService.findAllForTenant(
      tenantId,
      query,
      profile.branchId,
    );
  }

  /**
   * Fetch one radiology reporting doctor by id (full record incl. resolved
   * classification names).
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.radiologyReportingDoctorService.findById(
      id,
      tenantId,
      profile.branchId,
    );
  }

  /**
   * Update a radiology reporting doctor.
   */
  @Patch(':id')
  @RequireAnyPermission(...ADMIN_KEY_GROUPS.DOCTOR_UPDATE)
  @Audit({
    module: AuditModule.DOCTOR,
    action: AuditAction.UPDATE,
    description: 'Updated a radiology reporting doctor',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: UpdateRadiologyReportingDoctorDto,
  ) {
    return this.radiologyReportingDoctorService.update(
      id,
      tenantId,
      dto,
      profile.branchId,
    );
  }

  /**
   * Soft-delete a radiology reporting doctor.
   */
  @Delete(':id')
  @RequireAnyPermission(...ADMIN_KEY_GROUPS.DOCTOR_DELETE)
  @Audit({
    module: AuditModule.DOCTOR,
    action: AuditAction.DELETE,
    description: 'Deleted a radiology reporting doctor',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.radiologyReportingDoctorService.remove(
      id,
      tenantId,
      profile.branchId,
    );
  }
}
