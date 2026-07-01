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
import { CountryService } from './country.service';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';
import { ListCountryQueryDto } from './dto/list-country-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin country management (`/siteadmin/locations/countries`). Countries are
 * global reference data (no tenant/branch); `@Public()` opts out of the business
 * `JwtAuthGuard` and `SiteAdminPermissionGuard` enforces the SiteAdmin token.
 * Reads require `master-data:read`, writes `master-data:write` (content_admin and
 * above). Business users read this data via `LocationController`.
 */
@Controller('siteadmin/locations/countries')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminCountryController {
  constructor(private readonly countryService: CountryService) {}

  /** Create a country. */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateCountryDto) {
    return this.countryService.create(dto);
  }

  /** List countries (paginated; search + isActive filters). */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListCountryQueryDto) {
    return this.countryService.findAll(query.page ?? 1, query.limit ?? 20, {
      search: query.search,
      isActive: query.isActive,
    });
  }

  /** Fetch one country. */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.countryService.findById(id);
  }

  /** Update a country. */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateCountryDto) {
    return this.countryService.update(id, dto);
  }

  /** Soft-delete a country (blocked while it still has active states). */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.countryService.remove(id);
  }
}
