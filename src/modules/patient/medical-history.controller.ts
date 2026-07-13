import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PatientService } from './patient.service';
import { MedicalHistoryDto } from './dto/medical-history.dto';
import { UpdateMedicalHistoryDto } from './dto/update-medical-history.dto';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * Medical-history endpoints nested under a patient
 * (`/patients/:patientId/medical-history`). Business-authenticated; tenant
 * comes from the JWT and the patient from the route (validated in the service).
 * A patient can have many medical-history records (one-to-many). The global
 * `JwtAuthGuard` protects all routes.
 */
@Controller('patients/:patientId/medical-history')
export class MedicalHistoryController {
  constructor(private readonly patientService: PatientService) {}

  /** Add a medical-history record to the patient. */
  @Post()
  @Audit({
    module: AuditModule.MEDICAL_HISTORY,
    action: AuditAction.CREATE,
    description: 'Added a medical-history record',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('patientId') patientId: string,
    @Body() dto: MedicalHistoryDto,
  ) {
    return this.patientService.addMedicalHistory(
      tenantId,
      patientId,
      dto,
      personId,
    );
  }

  /** List the patient's medical-history records (most recent first). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('patientId') patientId: string,
  ) {
    return this.patientService.findMedicalHistories(tenantId, patientId);
  }

  /** Fetch one medical-history record. */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('patientId') patientId: string,
    @Param('id') id: string,
  ) {
    return this.patientService.findMedicalHistoryById(id, tenantId, patientId);
  }

  /** Update a medical-history record. */
  @Patch(':id')
  @Audit({
    module: AuditModule.MEDICAL_HISTORY,
    action: AuditAction.UPDATE,
    description: 'Updated a medical-history record',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('patientId') patientId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMedicalHistoryDto,
  ) {
    return this.patientService.updateMedicalHistory(
      id,
      tenantId,
      patientId,
      dto,
      personId,
    );
  }

  /** Soft-delete a medical-history record. */
  @Delete(':id')
  @Audit({
    module: AuditModule.MEDICAL_HISTORY,
    action: AuditAction.DELETE,
    description: 'Deleted a medical-history record',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('patientId') patientId: string,
    @Param('id') id: string,
  ) {
    return this.patientService.removeMedicalHistory(id, tenantId, patientId);
  }
}
