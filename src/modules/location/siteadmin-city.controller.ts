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
import { CityService } from './city.service';
import { CreateCityDto } from './dto/create-city.dto';
import { UpdateCityDto } from './dto/update-city.dto';
import { ListCityQueryDto } from './dto/list-city-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin city management (`/siteadmin/locations/cities`). Global reference
 * data; the parent state and its country are validated in the service (the
 * denormalized `countryId` must match the state's country). Auth mirrors
 * `SiteAdminCountryController` (SiteAdmin token, master-data read/write).
 */
@Controller('siteadmin/locations/cities')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminCityController {
  constructor(private readonly cityService: CityService) {}

  /** Create a city under a state (validates state + country consistency). */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateCityDto) {
    return this.cityService.create(dto);
  }

  /** List cities (paginated; search + stateId + countryId + isActive filters). */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListCityQueryDto) {
    return this.cityService.findAll(query.page ?? 1, query.limit ?? 20, {
      search: query.search,
      stateId: query.stateId,
      countryId: query.countryId,
      isActive: query.isActive,
    });
  }

  /** Fetch one city. */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.cityService.findById(id);
  }

  /** Update a city. */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateCityDto) {
    return this.cityService.update(id, dto);
  }

  /** Soft-delete a city (blocked while it still has active areas). */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.cityService.remove(id);
  }
}
