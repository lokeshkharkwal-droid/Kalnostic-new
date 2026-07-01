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
import { LabPanelService } from './lab-panel.service';
import { CreateLabPanelDto } from './dto/create-lab-panel.dto';
import { UpdateLabPanelDto } from './dto/update-lab-panel.dto';
import { ListLabPanelsDto } from './dto/list-lab-panels.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin global lab-panel **template** management
 * (`/siteadmin/lab-panels`). Templates carry `source = SITE_ADMIN` and no
 * tenant/branch/master data; their included tests reference SITE_ADMIN template
 * lab tests. Businesses adopt a template by cloning (see
 * `LabPanelOptionsController`).
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Reads require
 * `master-data:read`, writes `master-data:write` (content_admin and above).
 */
@Controller('siteadmin/lab-panels')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminLabPanelController {
  constructor(private readonly labPanelService: LabPanelService) {}

  /**
   * Create a global template lab panel (with its included template tests).
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateLabPanelDto) {
    return this.labPanelService.createTemplate(dto);
  }

  /**
   * List global template lab panels (paginated; search + status filters).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListLabPanelsDto) {
    return this.labPanelService.findAllTemplates(query);
  }

  /**
   * Fetch one global template lab panel with its included tests.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.labPanelService.findTemplateById(id);
  }

  /**
   * Update a global template lab panel (included tests replaced when provided).
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateLabPanelDto) {
    return this.labPanelService.updateTemplate(id, dto);
  }

  /**
   * Soft-delete a global template lab panel (cascade soft-delete of its tests).
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.labPanelService.removeTemplate(id);
  }
}
