import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { SalesSettingsService } from './sales-settings.service';
import { UpdateSalesSettingsDto } from './dto/update-sales-settings.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Tenant-level sales settings endpoints (business-authenticated; tenant comes
 * from the JWT). No branch scope — settings are per-business.
 */
@Controller('sales/settings')
export class SalesSettingsController {
  constructor(private readonly settingsService: SalesSettingsService) {}

  /** Fetch the tenant's sales settings (created lazily on first read). */
  @Get()
  get(@CurrentTenant() tenantId: string) {
    return this.settingsService.get(tenantId);
  }

  /** Update (shallow-merge) the tenant's sales settings. */
  @Put()
  @Audit({
    module: AuditModule.SALES_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated sales settings',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Body() dto: UpdateSalesSettingsDto,
  ) {
    return this.settingsService.update(tenantId, dto);
  }
}
