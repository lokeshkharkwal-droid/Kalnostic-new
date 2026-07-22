import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { AppointmentSettingsService } from './appointment-settings.service';
import { SaveAppointmentSettingsDto } from './dto/save-appointment-settings.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Appointment settings endpoints (Registration › Appointment Settings).
 * Business-authenticated; tenant from the JWT, branch from the active
 * profile. `GET` returns the effective settings (defaults merged with any
 * saved overrides); `PUT` upserts the active branch's settings. Falls back to
 * module defaults when the branch has never saved.
 */
@Controller('appointment-settings')
export class AppointmentSettingsController {
  constructor(private readonly settings: AppointmentSettingsService) {}

  /** Effective appointment settings for the active branch (defaults + overrides). */
  @Get()
  get(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.settings.getForBranch(tenantId, profile.branchId ?? '');
  }

  /** Save (upsert) the active branch's appointment settings. */
  @Put()
  @Audit({
    module: AuditModule.APPOINTMENT,
    action: AuditAction.UPDATE,
    description: 'Updated appointment settings',
  })
  save(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: SaveAppointmentSettingsDto,
  ) {
    return this.settings.saveForBranch(tenantId, profile.branchId ?? '', dto);
  }
}
