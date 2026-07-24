import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ConsoleSettingsService } from './console-settings.service';
import { SaveConsoleSettingsDto } from './dto/save-console-settings.dto';

/**
 * Registration console settings (order workflow defaults, TAT thresholds,
 * sample tracking). Business-authenticated; tenant comes from the JWT.
 * Uses GET + PUT because this is a singleton "save settings" form.
 */
@Controller('console-settings')
export class ConsoleSettingsController {
  constructor(
    private readonly consoleSettingsService: ConsoleSettingsService,
  ) {}

  /** Fetch current settings, creating defaults on first access. */
  @Get()
  getSettings(@CurrentTenant() tenantId: string) {
    return this.consoleSettingsService.getSettings(tenantId);
  }

  /** Save current settings with upsert semantics. */
  @Put()
  @Audit({
    module: AuditModule.CONSOLE_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated console settings',
    captureBody: true,
  })
  saveSettings(
    @CurrentTenant() tenantId: string,
    @Body() dto: SaveConsoleSettingsDto,
  ) {
    return this.consoleSettingsService.saveSettings(tenantId, dto);
  }
}
