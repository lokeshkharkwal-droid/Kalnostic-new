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
import { PatientService } from './patient.service';
import { CreatePatientDocumentDto } from './dto/create-patient-document.dto';
import { UpdatePatientDocumentDto } from './dto/update-patient-document.dto';
import { ListPatientDocumentsQueryDto } from './dto/list-patient-documents-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * Patient document / consent endpoints nested under a patient
 * (`/patients/:patientId/documents`). Business-authenticated; tenant comes from
 * the JWT and the patient from the route (validated in the service). One model
 * backs both Patient-Details tabs — the `category` query param / body field
 * splits DOCUMENT vs CONSENT. Only a `documentUrl` (e.g. AWS S3 link) is stored,
 * never the file itself. The global `JwtAuthGuard` protects all routes.
 */
@Controller('patients/:patientId/documents')
export class PatientDocumentController {
  constructor(private readonly patientService: PatientService) {}

  /** Add a document / consent record to the patient. */
  @Post()
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.CREATE,
    description: 'Added a patient document',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('patientId') patientId: string,
    @Body() dto: CreatePatientDocumentDto,
  ) {
    return this.patientService.addPatientDocument(
      tenantId,
      patientId,
      dto,
      personId,
    );
  }

  /** List the patient's document / consent records (optionally by category). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('patientId') patientId: string,
    @Query() query: ListPatientDocumentsQueryDto,
  ) {
    return this.patientService.findPatientDocuments(
      tenantId,
      patientId,
      query.category,
    );
  }

  /** Fetch one document / consent record. */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('patientId') patientId: string,
    @Param('id') id: string,
  ) {
    return this.patientService.findPatientDocumentById(id, tenantId, patientId);
  }

  /** Update a document / consent record. */
  @Patch(':id')
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.UPDATE,
    description: 'Updated a patient document',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('patientId') patientId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePatientDocumentDto,
  ) {
    return this.patientService.updatePatientDocument(
      id,
      tenantId,
      patientId,
      dto,
      personId,
    );
  }

  /** Soft-delete a document / consent record. */
  @Delete(':id')
  @Audit({
    module: AuditModule.PATIENT,
    action: AuditAction.DELETE,
    description: 'Deleted a patient document',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('patientId') patientId: string,
    @Param('id') id: string,
  ) {
    return this.patientService.removePatientDocument(id, tenantId, patientId);
  }
}
