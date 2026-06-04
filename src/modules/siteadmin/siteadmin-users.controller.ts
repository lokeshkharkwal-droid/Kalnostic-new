import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SiteAdminService } from './siteadmin.service';
import { CreateSiteAdminDto } from './dto/create-siteadmin.dto';
import { ChangeSiteAdminPasswordDto } from './dto/change-siteadmin-password.dto';
import { SiteAdminPermissionGuard } from './guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from './decorators/require-siteadmin-permission.decorator';
import { CurrentSiteAdmin } from './decorators/current-siteadmin.decorator';
import { SITE_ADMIN_PERM } from './constants/siteadmin-permissions.constant';
import { SiteAdminJwtPayload } from './types/siteadmin-jwt.type';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin self/team management. Protected by `SiteAdminPermissionGuard`;
 * management actions require the `siteadmin:manage` permission (super_owner).
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`.
 */
@Controller('siteadmin')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminUsersController {
  constructor(private readonly siteAdminService: SiteAdminService) {}

  /**
   * Current SiteAdmin session info (any authenticated siteadmin).
   */
  @Get('me')
  me(@CurrentSiteAdmin() admin: SiteAdminJwtPayload) {
    return {
      siteadmin_id: admin.siteadmin_id,
      email: admin.email,
      role: admin.role,
    };
  }

  /**
   * Create a SiteAdmin sub-account.
   */
  @Post('users')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.SITEADMIN_MANAGE)
  create(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Body() dto: CreateSiteAdminDto,
  ) {
    return this.siteAdminService.create(dto, actorId);
  }

  /**
   * List all SiteAdmin accounts.
   */
  @Get('users')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.SITEADMIN_MANAGE)
  findAll() {
    return this.siteAdminService.findAll();
  }

  /**
   * Change a SiteAdmin's password.
   */
  @Patch('users/:id/password')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.SITEADMIN_MANAGE)
  async changePassword(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: ChangeSiteAdminPasswordDto,
  ) {
    await this.siteAdminService.changePassword(id, dto.newPassword, actorId);
    return { message: 'Password changed successfully' };
  }

  /**
   * Deactivate a SiteAdmin account.
   */
  @Patch('users/:id/deactivate')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.SITEADMIN_MANAGE)
  async deactivate(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Param('id') id: string,
  ) {
    await this.siteAdminService.deactivate(id, actorId);
    return { message: 'SiteAdmin deactivated' };
  }
}
