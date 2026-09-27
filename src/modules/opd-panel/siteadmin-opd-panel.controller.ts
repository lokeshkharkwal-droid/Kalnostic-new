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
import { OpdPanelService } from './opd-panel.service';
import { CreateOpdPanelDto } from './dto/create-opd-panel.dto';
import { UpdateOpdPanelDto } from './dto/update-opd-panel.dto';
import { ListOpdPanelsDto } from './dto/list-opd-panels.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * SiteAdmin global opd-panel **template** management
 * (`/siteadmin/opd-panels`). Templates carry `source = SITE_ADMIN`; their
 * included tests reference SITE_ADMIN template opd tests. Businesses adopt a
 * template by cloning.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`.
 */
@Controller('siteadmin/opd-panels')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminOpdPanelController {
  constructor(private readonly opdPanelService: OpdPanelService) {}

  /**
   * Create a global template opd panel (with its included template tests).
   */
  @Post()
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Created a template opd panel',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateOpdPanelDto) {
    return this.opdPanelService.createTemplate(dto);
  }

  /**
   * List global template opd panels.
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListOpdPanelsDto) {
    return this.opdPanelService.findAllTemplates(query);
  }

  /**
   * Fetch one global template opd panel with its included tests.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.opdPanelService.findTemplateById(id);
  }

  /**
   * Update a global template opd panel (included tests replaced when provided).
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Updated a template opd panel',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateOpdPanelDto) {
    return this.opdPanelService.updateTemplate(id, dto);
  }

  /**
   * Soft-delete a global template opd panel (cascade soft-delete of its tests).
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.DELETE,
    description: 'Deleted a template opd panel',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.opdPanelService.removeTemplate(id);
  }
}
