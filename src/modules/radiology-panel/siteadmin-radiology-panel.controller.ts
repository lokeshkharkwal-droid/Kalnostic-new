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
import { RadiologyPanelService } from './radiology-panel.service';
import { CreateRadiologyPanelDto } from './dto/create-radiology-panel.dto';
import { UpdateRadiologyPanelDto } from './dto/update-radiology-panel.dto';
import { ListRadiologyPanelsDto } from './dto/list-radiology-panels.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * SiteAdmin global radiology-panel **template** management
 * (`/siteadmin/radiology-panels`). Templates carry `source = SITE_ADMIN`; their
 * included tests reference SITE_ADMIN template radiology tests. Businesses adopt a
 * template by cloning.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`.
 */
@Controller('siteadmin/radiology-panels')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminRadiologyPanelController {
  constructor(private readonly radiologyPanelService: RadiologyPanelService) {}

  /**
   * Create a global template radiology panel (with its included template tests).
   */
  @Post()
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.CREATE,
    description: 'Created a template radiology panel',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateRadiologyPanelDto) {
    return this.radiologyPanelService.createTemplate(dto);
  }

  /**
   * List global template radiology panels.
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListRadiologyPanelsDto) {
    return this.radiologyPanelService.findAllTemplates(query);
  }

  /**
   * Fetch one global template radiology panel with its included tests.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.radiologyPanelService.findTemplateById(id);
  }

  /**
   * Update a global template radiology panel (included tests replaced when provided).
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.UPDATE,
    description: 'Updated a template radiology panel',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateRadiologyPanelDto) {
    return this.radiologyPanelService.updateTemplate(id, dto);
  }

  /**
   * Soft-delete a global template radiology panel (cascade soft-delete of its tests).
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.DELETE,
    description: 'Deleted a template radiology panel',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.radiologyPanelService.removeTemplate(id);
  }
}
