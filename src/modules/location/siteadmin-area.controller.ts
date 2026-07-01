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
import { AreaService } from './area.service';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { ListAreaQueryDto } from './dto/list-area-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin area/locality management (`/siteadmin/locations/areas`). Global
 * reference data; the parent city and its state/country are validated in the
 * service (the denormalized `stateId`/`countryId` must match the city's). Auth
 * mirrors `SiteAdminCountryController` (SiteAdmin token, master-data read/write).
 */
@Controller('siteadmin/locations/areas')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminAreaController {
  constructor(private readonly areaService: AreaService) {}

  /** Create an area under a city (validates city + state + country consistency). */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateAreaDto) {
    return this.areaService.create(dto);
  }

  /** List areas (paginated; search + cityId + stateId + countryId + isActive). */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListAreaQueryDto) {
    return this.areaService.findAll(query.page ?? 1, query.limit ?? 20, {
      search: query.search,
      cityId: query.cityId,
      stateId: query.stateId,
      countryId: query.countryId,
      isActive: query.isActive,
    });
  }

  /** Fetch one area. */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.areaService.findById(id);
  }

  /** Update an area. */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateAreaDto) {
    return this.areaService.update(id, dto);
  }

  /** Soft-delete an area (leaf node; no child check). */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.areaService.remove(id);
  }
}
