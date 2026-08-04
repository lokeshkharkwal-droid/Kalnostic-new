import { Controller, Get } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

/**
 * Business-facing tenant reads — protected by the global business `JwtAuthGuard`
 * (no `@Public()`), scoped to the caller's own tenant via `@CurrentTenant()`.
 * Mounted under `/tenant`, distinct from the SiteAdmin `/siteadmin/tenants`
 * controller, so a business user can read its own configuration without any
 * SiteAdmin permission.
 */
@Controller('tenant')
export class TenantLocaleController {
  constructor(private readonly tenantService: TenantService) {}

  /**
   * Return the caller tenant's locale (time zone + currency + date format +
   * language) so the frontend can render UTC timestamps in business-local time
   * and format money with the configured currency.
   */
  @Get('locale')
  getLocale(@CurrentTenant() tenantId: string) {
    return this.tenantService.getLocale(tenantId);
  }
}
