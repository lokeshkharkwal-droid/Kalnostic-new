import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { ListRegisteredUsersQueryDto } from './dto/list-registered-users-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin read-only view of **every registered person** across the whole
 * portal (`/siteadmin/registered-users`) — staff and self-registered patients,
 * with no tenant filtering. Distinct from the tenant-scoped `/users/manage`
 * (business JWT) that a business uses to manage only its own staff.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. These are business
 * users, so access requires `business:read` (operations_admin and above),
 * matching the Businesses surface.
 */
@Controller('siteadmin/registered-users')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminRegisteredUsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * List registered persons (paginated; `search` over username/email +
   * `status` = active/inactive).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  findAll(@Query() query: ListRegisteredUsersQueryDto) {
    return this.usersService.listRegisteredUsers(query);
  }

  /**
   * Full read-only detail for one person, including their role assignments
   * across businesses.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_READ)
  findOne(@Param('id') id: string) {
    return this.usersService.getRegisteredUser(id);
  }
}
