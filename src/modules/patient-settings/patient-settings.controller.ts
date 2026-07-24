import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { PatientSettingsService } from './patient-settings.service';
import { SavePatientSettingsDto } from './dto/save-patient-settings.dto';

/**
 * Registration patient settings (patient ID format, mandatory fields,
 * consent & privacy). Business-authenticated; tenant comes from the JWT.
 * Uses GET + PUT because this is a singleton "save settings" form.
 */
@Controller('patient-settings')
export class PatientSettingsController {
  constructor(
    private readonly patientSettingsService: PatientSettingsService,
  ) {}

  /** Fetch current settings, creating defaults on first access. */
  @Get()
  getSettings(@CurrentTenant() tenantId: string) {
    return this.patientSettingsService.getSettings(tenantId);
  }

  /** Save current settings with upsert semantics. */
  @Put()
  @Audit({
    module: AuditModule.PATIENT_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated patient settings',
    captureBody: true,
  })
  saveSettings(
    @CurrentTenant() tenantId: string,
    @Body() dto: SavePatientSettingsDto,
  ) {
    return this.patientSettingsService.saveSettings(tenantId, dto);
  }
}
