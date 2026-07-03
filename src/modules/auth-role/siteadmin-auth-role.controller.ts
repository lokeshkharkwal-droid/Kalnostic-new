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
import { AuthRoleService } from './auth-role.service';
import { CreateAuthRoleDto } from './dto/create-auth-role.dto';
import { UpdateAuthRoleDto } from './dto/update-auth-role.dto';
import { ListAuthRolesQueryDto } from './dto/list-auth-roles-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin management of the **global** role catalogue (`/siteadmin/roles`) —
 * the roles shared by every tenant (`tenant_id = null`): the 24 seeded built-ins
 * plus SiteAdmin-created global roles. Distinct from the tenant-scoped `/roles`
 * (business JWT) where a tenant manages only its own custom roles.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Roles are master-data
 * content, so reads require `master-data:read` and writes `master-data:write`
 * (content_admin and above), matching the department/lab-test template surfaces.
 */
@Controller('siteadmin/roles')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminAuthRoleController {
  constructor(private readonly authRoleService: AuthRoleService) {}

  /**
   * Create a new global role (available to all tenants).
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateAuthRoleDto) {
    return this.authRoleService.createGlobal(dto);
  }

  /**
   * List the global role catalogue (paginated; `search` over name/key + `status`).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListAuthRolesQueryDto) {
    return this.authRoleService.findAllGlobal(
      query.page ?? 1,
      query.limit ?? 20,
      {
        search: query.search,
        status: query.status,
      },
    );
  }

  /**
   * Fetch one global role by id.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.authRoleService.findGlobalById(id);
  }

  /**
   * Update a global role. Built-in (system) roles accept only description/status;
   * SiteAdmin-created global roles are fully editable.
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateAuthRoleDto) {
    return this.authRoleService.updateGlobal(id, dto);
  }
}
