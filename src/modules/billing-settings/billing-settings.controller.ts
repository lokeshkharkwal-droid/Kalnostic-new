import { UseGuards, Body, Controller, Get, Post } from '@nestjs/common';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
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
@UseGuards(PermissionGuard)
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
  @RequirePermission(PERMISSION_KEYS.FIN_SETTINGS_INVOICE_VIEW)
  getSettings(@CurrentTenant() tenantId: string) {
    return this.billingSettingsService.getSettings(tenantId);
  }

  /** Save current settings with upsert semantics. */
  @Post()
  @RequirePermission(PERMISSION_KEYS.FIN_SETTINGS_INVOICE_UPDATE)
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
