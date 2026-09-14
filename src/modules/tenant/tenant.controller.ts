import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, AuditModule, SubscriptionStatus } from '@prisma/client';
import { TenantService } from './tenant.service';
import { ExchangeTenantIdService } from './exchange-tenant-id.service';
import { ExchangeRegistrationService } from '../communication/exchange/exchange-registration.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { SetAdminPasswordDto } from './dto/set-admin-password.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantConfigurationDto } from './dto/update-tenant-configuration.dto';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { ListTenantsQueryDto } from './dto/list-tenants-query.dto';
import { BranchQueryDto } from '../branch/dto/branch-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { CurrentSiteAdmin } from '../siteadmin/decorators/current-siteadmin.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Tenant (business) management — operated by SiteAdmin only. Mounted under
 * `/siteadmin/tenants` and protected by the SiteAdmin permission guard.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`.
 */
@Controller('siteadmin/tenants')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly exchangeTenantIdService: ExchangeTenantIdService,
    private readonly exchangeRegistrationService: ExchangeRegistrationService,
  ) {}

  /**
   * Create a tenant + its first business-admin. The admin's login password is
   * chosen by SiteAdmin in the request, so nothing sensitive is returned.
   */
  @Post()
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.CREATE,
    description: 'Created a business',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_CREATE)
  create(
    @CurrentSiteAdmin('siteadmin_id') siteAdminId: string,
    @Body() dto: CreateTenantDto,
  ) {
    return this.tenantService.create(dto, siteAdminId);
  }

  /**
   * List tenants (paginated), optionally filtered by name/slug/email search
   * and subscription status.
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  findAll(@Query() query: ListTenantsQueryDto) {
    return this.tenantService.findAll(query);
  }

  /**
   * Aggregate business counts for the SiteAdmin dashboard
   * (total / active / trial / suspended). Declared before `:id` so the static
   * path isn't captured by the param route.
   */
  @Get('dashboard-counts')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  getDashboardCounts() {
    return this.tenantService.getDashboardCounts();
  }

  /**
   * Assign a stable integer `exchangeTenantId` to every tenant missing one, so
   * per-tenant Exchange message counts continue (migrated tenants keep their
   * legacy id; native tenants get the next value in the sequence). Idempotent —
   * safe to call repeatedly; existing ids never change. Declared before `:id` so
   * the static path is not captured by the param route.
   */
  @Post('sync-exchange-ids')
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.UPDATE,
    description: 'Synced tenant Exchange ids',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.SYSTEM_CONFIG)
  syncExchangeIds() {
    return this.exchangeTenantIdService.backfillAll();
  }

  /**
   * Register every tenant that has an `exchangeTenantId` but is not yet
   * registered as a client on the external Exchange server (the `/clients` step).
   * Idempotent — already-registered tenants are skipped. Declared before `:id`.
   */
  @Post('register-exchange')
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.UPDATE,
    description: 'Registered tenants with the Exchange',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.SYSTEM_CONFIG)
  registerAllExchange() {
    return this.exchangeRegistrationService.registerAllUnregistered();
  }

  /**
   * Register one tenant as a client on the external Exchange server. Idempotent
   * (no-op if already registered); reuses the tenant's `exchangeTenantId` as
   * `peer_tenant_id` — never creates a new id.
   */
  @Post(':id/register-exchange')
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.UPDATE,
    description: 'Registered a business with the Exchange',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_CREATE)
  registerExchange(@Param('id') id: string) {
    return this.exchangeRegistrationService.registerTenant(id);
  }

  /**
   * The tenant's current Exchange client record (`GET /clients/show`).
   */
  @Get(':id/exchange-status')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  getExchangeStatus(@Param('id') id: string) {
    return this.exchangeRegistrationService.getStatus(id);
  }

  /**
   * The tenant's Exchange usage/message counts (`GET /clientsbilling/show`).
   */
  @Get(':id/exchange-usage')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  getExchangeUsage(@Param('id') id: string) {
    return this.exchangeRegistrationService.getUsage(id);
  }

  /**
   * Fetch one tenant by id, with its resolved location relations for display.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  findOne(@Param('id') id: string) {
    return this.tenantService.getDetail(id);
  }

  /**
   * List a tenant's branches (paginated) for the SiteAdmin business summary.
   */
  @Get(':id/branches')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  getBranches(@Param('id') id: string, @Query() query: BranchQueryDto) {
    return this.tenantService.getBranchesForTenant(id, query);
  }

  /**
   * Update a tenant's editable fields.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.UPDATE,
    description: 'Updated a business',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_CREATE)
  update(
    @CurrentSiteAdmin('siteadmin_id') siteAdminId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.tenantService.update(id, dto, siteAdminId);
  }

  /**
   * Suspend a business — sets `subscriptionStatus` to `SUSPENDED`.
   */
  @Patch(':id/suspend')
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.UPDATE,
    description: 'Suspended a business',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_SUSPEND)
  suspend(
    @CurrentSiteAdmin('siteadmin_id') siteAdminId: string,
    @Param('id') id: string,
  ) {
    return this.tenantService.setSubscriptionStatus(
      id,
      SubscriptionStatus.SUSPENDED,
      siteAdminId,
    );
  }

  /**
   * Reactivate a suspended business — sets `subscriptionStatus` to `ACTIVE`.
   */
  @Patch(':id/reactivate')
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.UPDATE,
    description: 'Reactivated a business',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_REACTIVATE)
  reactivate(
    @CurrentSiteAdmin('siteadmin_id') siteAdminId: string,
    @Param('id') id: string,
  ) {
    return this.tenantService.setSubscriptionStatus(
      id,
      SubscriptionStatus.ACTIVE,
      siteAdminId,
    );
  }

  /**
   * Get the tenant's Business Configuration (site URLs / branding / limits /
   * theme). Returns a defaults row on first access.
   */
  @Get(':id/configuration')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  getConfiguration(@Param('id') id: string) {
    return this.tenantService.getConfiguration(id);
  }

  /**
   * Update the tenant's Business Configuration (upsert; partial payload).
   */
  @Put(':id/configuration')
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.UPDATE,
    description: 'Updated business configuration',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_CREATE)
  updateConfiguration(
    @CurrentSiteAdmin('siteadmin_id') siteAdminId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTenantConfigurationDto,
  ) {
    return this.tenantService.updateConfiguration(id, dto, siteAdminId);
  }

  /**
   * Get the tenant's Business Settings (referral / payment / commission /
   * wallet rules). Returns a defaults row on first access.
   */
  @Get(':id/settings')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  getSettings(@Param('id') id: string) {
    return this.tenantService.getSettings(id);
  }

  /**
   * Update the tenant's Business Settings (upsert; partial payload).
   */
  @Put(':id/settings')
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.UPDATE,
    description: 'Updated business settings',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_CREATE)
  updateSettings(
    @CurrentSiteAdmin('siteadmin_id') siteAdminId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTenantSettingsDto,
  ) {
    return this.tenantService.updateSettings(id, dto, siteAdminId);
  }

  /**
   * Get the tenant's business-admin account details.
   */
  @Get(':id/admin')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  getBusinessAdmin(@Param('id') id: string) {
    return this.tenantService.getBusinessAdmin(id);
  }

  /**
   * Reset the business-admin password (returns a one-time temp password).
   */
  @Post(':id/admin/reset-password')
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.UPDATE,
    description: 'Reset business admin password',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_CREATE)
  resetAdminPassword(
    @CurrentSiteAdmin('siteadmin_id') siteAdminId: string,
    @Param('id') id: string,
  ) {
    return this.tenantService.resetBusinessAdminPassword(id, siteAdminId);
  }

  /**
   * Set the business-admin password to a SiteAdmin-chosen value (non-temp).
   */
  @Put(':id/admin/password')
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.UPDATE,
    description: 'Set business admin password',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_CREATE)
  setAdminPassword(
    @CurrentSiteAdmin('siteadmin_id') siteAdminId: string,
    @Param('id') id: string,
    @Body() dto: SetAdminPasswordDto,
  ) {
    return this.tenantService.setBusinessAdminPassword(
      id,
      dto.adminPassword,
      siteAdminId,
    );
  }
}
