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
import { SubscriptionStatus } from '@prisma/client';
import { TenantService } from './tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
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
  constructor(private readonly tenantService: TenantService) {}

  /**
   * Create a tenant + its first business-admin (returns a one-time temp password).
   */
  @Post()
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
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_CREATE)
  resetAdminPassword(
    @CurrentSiteAdmin('siteadmin_id') siteAdminId: string,
    @Param('id') id: string,
  ) {
    return this.tenantService.resetBusinessAdminPassword(id, siteAdminId);
  }
}
