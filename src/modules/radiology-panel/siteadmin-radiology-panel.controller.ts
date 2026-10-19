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
import { AuditAction, AuditModule } from '@prisma/client';
import { RadiologyPanelService } from './radiology-panel.service';
import { CreateRadiologyPanelDto } from './dto/create-radiology-panel.dto';
import { UpdateRadiologyPanelDto } from './dto/update-radiology-panel.dto';
import { BrowseRadiologyPanelTemplatesDto } from './dto/list-radiology-panels.dto';
import { RadiologyPanelOptionsQueryDto } from './dto/radiology-panel-options-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * SiteAdmin global radiology-panel **template** management
 * (`/siteadmin/radiology-panels`). Templates carry `source = SITE_ADMIN` and no
 * tenant/branch/master data; their included tests reference SITE_ADMIN template
 * radiology tests. Businesses adopt a template by cloning (see
 * `RadiologyPanelOptionsController`).
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Reads require
 * `master-data:read`, writes `master-data:write` (content_admin and above).
 * Reuses the `AuditModule.LAB_PANEL` audit enum (radiology has no own value).
 */
@Controller('siteadmin/radiology-panels')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminRadiologyPanelController {
  constructor(private readonly radiologyPanelService: RadiologyPanelService) {}

  /** Create a global template radiology panel (with its included template tests). */
  @Post()
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Created a template radiology panel',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateRadiologyPanelDto) {
    return this.radiologyPanelService.createTemplate(dto);
  }

  /** List global template radiology panels (paginated; search + status filters). */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: BrowseRadiologyPanelTemplatesDto) {
    return this.radiologyPanelService.findAllTemplates(query);
  }

  /**
   * Lightweight `{ id, name }` options for SITE_ADMIN template radiology panels.
   * Declared before `:id` so `options` isn't matched as an id. `branchId` on the
   * query is ignored (templates have no branch).
   */
  @Get('options')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOptions(@Query() query: RadiologyPanelOptionsQueryDto) {
    return this.radiologyPanelService.findTemplateOptions({
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /** Fetch one global template radiology panel with its included tests. */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.radiologyPanelService.findTemplateById(id);
  }

  /** Update a global template radiology panel (included tests replaced when provided). */
  @Patch(':id')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Updated a template radiology panel',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateRadiologyPanelDto) {
    return this.radiologyPanelService.updateTemplate(id, dto);
  }

  /** Soft-delete a global template radiology panel (cascade soft-delete of its tests). */
  @Delete(':id')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.DELETE,
    description: 'Deleted a template radiology panel',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.radiologyPanelService.removeTemplate(id);
  }
}
