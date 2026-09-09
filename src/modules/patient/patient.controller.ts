import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { PatientService } from './patient.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { UpdatePatientNotificationPreferencesDto } from './dto/update-patient-notification-preferences.dto';
import { ListPatientQueryDto } from './dto/list-patient-query.dto';
import { CrossTenantLookupQueryDto } from './dto/cross-tenant-lookup-query.dto';
import { ImportCrossTenantPatientDto } from './dto/import-cross-tenant-patient.dto';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';

/**
 * Patient endpoints (business-authenticated; tenant comes from the JWT and the
 * registration branch from the active profile). The global `JwtAuthGuard`
 * protects all routes.
 */
@Controller('patients')
@UseGuards(PermissionGuard)
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  /**
   * Register a patient in the caller's tenant, optionally with initial
   * medical-history records. The registration branch is taken from the active
   * profile (JWT), never the body.
   */
  @Post()
  @RequirePermission(PERMISSION_KEYS.REG_CREATE_PATIENT)
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.CREATE,
    description: 'Registered a patient',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreatePatientDto,
  ) {
    return this.patientService.create(tenantId, dto, {
      branchId: profile.branchId,
      actorId: personId,
    });
  }

  /**
   * List patients in the caller's tenant (paginated). Supports optional
   * `search` (name/mobile), `patientCategory`, `status`, `isActive`, `gender`,
   * `bloodGroup`, a registration-date range, and `branchId` filters.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListPatientQueryDto,
  ) {
    return this.patientService.findAllForTenant(
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      {
        search: query.search,
        patientCategory: query.patientCategory,
        status: query.status,
        isActive: query.isActive,
        gender: query.gender,
        bloodGroup: query.bloodGroup,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        branchId: query.branchId,
        includeFamily: query.includeFamily,
      },
    );
  }

  /**
   * Aggregate patient counts for the dashboard summary cards, scoped to the
   * caller's tenant and active branch. Declared before `:id` so `stats` is not
   * captured as a patient id.
   */
  @Get('stats')
  getStats(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.patientService.getStats(tenantId, profile.branchId);
  }

  /**
   * Look up a mobile number across ALL tenants via the shared `Person` identity.
   * Used by order creation when no existing patient is selected, to detect a
   * patient already registered at another business before a duplicate is created.
   * Declared before `:id` so the static path isn't captured as a patient id.
   */
  @Get('cross-tenant-lookup')
  crossTenantLookup(
    @CurrentTenant() tenantId: string,
    @Query() query: CrossTenantLookupQueryDto,
  ) {
    return this.patientService.crossTenantLookup(tenantId, query.phone);
  }

  /**
   * Reuse a patient that exists in another tenant: create the caller tenant's own
   * patient projection linked to the shared identity (idempotent — never
   * duplicated). Called after the operator confirms the cross-tenant match.
   */
  @Post('import-from-person')
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.CREATE,
    description: 'Reused a cross-tenant patient identity',
  })
  importFromPerson(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportCrossTenantPatientDto,
  ) {
    return this.patientService.importFromPerson(tenantId, dto.personId, {
      branchId: profile.branchId,
      actorId: personId,
    });
  }

  /** Fetch one patient (with active medical-history records). */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.patientService.findById(id, tenantId);
  }

  /** Update a patient's details. */
  @Patch(':id')
  @RequirePermission(PERMISSION_KEYS.REG_UPDATE_PATIENT_DETAILS)
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.UPDATE,
    description: 'Updated a patient',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
  ) {
    return this.patientService.update(id, tenantId, dto, {
      branchId: profile.branchId,
      actorId: personId,
    });
  }

  /**
   * Read a patient's notification opt-out preferences (channels they've opted out
   * of globally + per feature). Used by the Patient Detail preferences UI and by
   * patient self-service.
   */
  @Get(':id/notification-preferences')
  getNotificationPreferences(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.patientService.getNotificationPreferences(id, tenantId);
  }

  /** Replace a patient's notification opt-out preferences. */
  @Put(':id/notification-preferences')
  @RequirePermission(PERMISSION_KEYS.REG_UPDATE_PATIENT_DETAILS)
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.UPDATE,
    description: 'Updated patient notification preferences',
  })
  updateNotificationPreferences(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePatientNotificationPreferencesDto,
  ) {
    return this.patientService.updateNotificationPreferences(
      id,
      tenantId,
      dto,
      personId,
    );
  }

  /** Soft-delete a patient (and its medical-history records). */
  @Delete(':id')
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.DELETE,
    description: 'Deleted a patient',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.patientService.remove(id, tenantId);
  }
}
