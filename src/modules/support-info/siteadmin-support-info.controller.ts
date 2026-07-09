import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupportInfoService } from './support-info.service';
import { CreateSupportInfoDto } from './dto/create-support-info.dto';
import { UpdateSupportInfoDto } from './dto/update-support-info.dto';
import { ListSupportInfoQueryDto } from './dto/list-support-info-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { CurrentSiteAdmin } from '../siteadmin/decorators/current-siteadmin.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin support-information management (`/siteadmin/support-info`). Records
 * are platform-level (no tenant) and shared across all businesses.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Support content is
 * master-data content, so reads require `master-data:read` and writes
 * `master-data:write` (content_admin and above) — mirroring
 * `siteadmin/departments` and `siteadmin/templates`.
 */
@Controller('siteadmin/support-info')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminSupportInfoController {
  constructor(private readonly supportInfoService: SupportInfoService) {}

  /**
   * Create a support-information record.
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Body() dto: CreateSupportInfoDto,
  ) {
    return this.supportInfoService.create(actorId, dto);
  }

  /**
   * List support-information records (paginated; `search` over metaType/code,
   * `status` active/inactive filter).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListSupportInfoQueryDto) {
    return this.supportInfoService.findAll(query);
  }

  /**
   * Fetch one support-information record.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.supportInfoService.findById(id);
  }

  /**
   * Update a support-information record.
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSupportInfoDto,
  ) {
    return this.supportInfoService.update(id, actorId, dto);
  }

  /**
   * Soft-delete a support-information record.
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.supportInfoService.remove(id);
  }
}
