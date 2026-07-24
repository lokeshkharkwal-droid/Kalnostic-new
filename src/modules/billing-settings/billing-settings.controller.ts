import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { BillingSettingsService } from './billing-settings.service';
import { SaveBillingSettingsDto } from './dto/save-billing-settings.dto';

/**
 * Registration billing settings. Business-authenticated; tenant comes from the
 * JWT. Uses GET + POST because this is a singleton "save settings" form.
 */
@Controller('business-admin/billing-settings')
export class BillingSettingsController {
  constructor(
    private readonly billingSettingsService: BillingSettingsService,
  ) {}

  /** Select/list enum values for the frontend controls. */
  @Get('enums')
  getEnums() {
    return this.billingSettingsService.getEnums();
  }

  /** Fetch current settings, creating defaults on first access. */
  @Get()
  getSettings(@CurrentTenant() tenantId: string) {
    return this.billingSettingsService.getSettings(tenantId);
  }

  /** Save current settings with upsert semantics. */
  @Post()
  @Audit({
    module: AuditModule.BILLING_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Saved billing settings',
    captureBody: true,
  })
  saveSettings(
    @CurrentTenant() tenantId: string,
    @Body() dto: SaveBillingSettingsDto,
  ) {
    return this.billingSettingsService.saveSettings(tenantId, dto);
  }
}
