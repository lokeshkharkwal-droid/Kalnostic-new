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
import { EquipmentService } from './equipment.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { ListEquipmentDto } from './dto/list-equipment.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { CurrentSiteAdmin } from '../siteadmin/decorators/current-siteadmin.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin lab-equipment management (`/siteadmin/equipment`). An equipment is a
 * platform-level global catalogue entry carrying an adapter code, a description,
 * three rich-text documents, and the SITE_ADMIN lab-test templates it processes
 * (no tenant).
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Reads require
 * `master-data:read`, writes `master-data:write` (content_admin and above).
 */
@Controller('siteadmin/equipment')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminEquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  /**
   * Create an equipment with its selected lab tests.
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Body() dto: CreateEquipmentDto,
  ) {
    return this.equipmentService.create(actorId, dto);
  }

  /**
   * List equipment (paginated; search by name). Each row carries the total
   * number of mapped lab tests.
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListEquipmentDto) {
    return this.equipmentService.findAll(query);
  }

  /**
   * Fetch one equipment with all its mapped lab tests.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.equipmentService.findById(id);
  }

  /**
   * Update an equipment (mapped lab tests replaced when `labTestIds` provided).
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEquipmentDto,
  ) {
    return this.equipmentService.update(id, actorId, dto);
  }

  /**
   * Soft-delete an equipment (cascade soft-delete of all its lab-test mappings).
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.equipmentService.remove(id);
  }
}
