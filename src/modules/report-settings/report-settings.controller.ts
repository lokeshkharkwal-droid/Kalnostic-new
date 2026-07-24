import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ReportSettingsService } from './report-settings.service';
import { SaveReportSettingsDto } from './dto/save-report-settings.dto';

/**
 * Registration report settings (report header/branding, signatures,
 * delivery & publishing policy). Business-authenticated; tenant comes from
 * the JWT. Uses GET + PUT because this is a singleton "save settings" form.
 */
@Controller('report-settings')
export class ReportSettingsController {
  constructor(private readonly reportSettingsService: ReportSettingsService) {}

  /** Fetch current settings, creating defaults on first access. */
  @Get()
  getSettings(@CurrentTenant() tenantId: string) {
    return this.reportSettingsService.getSettings(tenantId);
  }

  /** Save current settings with upsert semantics. */
  @Put()
  @Audit({
    module: AuditModule.REPORT_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated report settings',
    captureBody: true,
  })
  saveSettings(
    @CurrentTenant() tenantId: string,
    @Body() dto: SaveReportSettingsDto,
  ) {
    return this.reportSettingsService.saveSettings(tenantId, dto);
  }
}
