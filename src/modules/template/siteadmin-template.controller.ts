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
import { TemplateService } from './template.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { ListTemplateQueryDto } from './dto/list-template-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin global **messaging template** management (`/siteadmin/templates`).
 * Templates here carry no tenant (`tenant_id` NULL) and no branch — they are the
 * shared, platform-level Email / SMS / WhatsApp / IAM / IAA / PBN master
 * templates that businesses inherit.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Reads require
 * `master-data:read`, writes `master-data:write` (content_admin and above) —
 * mirroring `siteadmin/pdf-report-templates`.
 */
@Controller('siteadmin/templates')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminTemplateController {
  constructor(private readonly templateService: TemplateService) {}

  /**
   * Create a global template.
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateTemplateDto) {
    return this.templateService.createGlobal(dto);
  }

  /**
   * List global templates (paginated; optional channel/feature/type/level/
   * branch-type filters, display-title search, and boolean flags).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListTemplateQueryDto) {
    return this.templateService.findAllGlobal(
      query.page ?? 1,
      query.limit ?? 20,
      {
        preference: query.preference,
        feature: query.feature,
        messageType: query.messageType,
        level: query.level,
        applicableBranchType: query.applicableBranchType,
        search: query.search,
        isActive: query.isActive,
        isEnabled: query.isEnabled,
        isDefault: query.isDefault,
      },
    );
  }

  /**
   * Fetch one global template by id.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.templateService.findGlobalById(id);
  }

  /**
   * Update a global template.
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.templateService.updateGlobal(id, dto);
  }

  /**
   * Soft-delete a global template.
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.templateService.removeGlobal(id);
  }

  /**
   * Duplicate a global template (copy with " (Copy)" appended to the title).
   */
  @Post(':id/duplicate')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  duplicate(@Param('id') id: string) {
    return this.templateService.duplicateGlobal(id);
  }
}
