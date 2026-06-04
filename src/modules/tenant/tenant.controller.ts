import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TenantService } from './tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
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
   * List all tenants (paginated).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  findAll(@Query() query: PaginationQueryDto) {
    return this.tenantService.findAll(query.page ?? 1, query.limit ?? 20);
  }

  /**
   * Fetch one tenant by id.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  findOne(@Param('id') id: string) {
    return this.tenantService.findById(id);
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
