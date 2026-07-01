import { Controller, Get, Param, Query } from '@nestjs/common';
import { CountryService } from './country.service';
import { StateService } from './state.service';
import { CityService } from './city.service';
import { AreaService } from './area.service';
import { ListCountryQueryDto } from './dto/list-country-query.dto';
import { ListStateQueryDto } from './dto/list-state-query.dto';
import { ListCityQueryDto } from './dto/list-city-query.dto';
import { ListAreaQueryDto } from './dto/list-area-query.dto';

/**
 * Business-facing, read-only location lookups (`/locations/...`) for populating
 * cascading Country → State → City → Area dropdowns. Business-authenticated (the
 * global `JwtAuthGuard` applies; no `@Public()`). The data is platform-level, so
 * no tenant scoping is needed — every tenant sees the same shared location master.
 * Writes live under `/siteadmin/locations/...` (SiteAdmin only).
 */
@Controller('locations')
export class LocationController {
  constructor(
    private readonly countryService: CountryService,
    private readonly stateService: StateService,
    private readonly cityService: CityService,
    private readonly areaService: AreaService,
  ) {}

  /** List active countries (paginated; search + isActive filters). */
  @Get('countries')
  findCountries(@Query() query: ListCountryQueryDto) {
    return this.countryService.findAll(query.page ?? 1, query.limit ?? 20, {
      search: query.search,
      isActive: query.isActive,
    });
  }

  /** Fetch one country. */
  @Get('countries/:id')
  findCountry(@Param('id') id: string) {
    return this.countryService.findById(id);
  }

  /** List active states, typically filtered by `countryId`. */
  @Get('states')
  findStates(@Query() query: ListStateQueryDto) {
    return this.stateService.findAll(query.page ?? 1, query.limit ?? 20, {
      search: query.search,
      countryId: query.countryId,
      isActive: query.isActive,
    });
  }

  /** Fetch one state. */
  @Get('states/:id')
  findState(@Param('id') id: string) {
    return this.stateService.findById(id);
  }

  /** List active cities, typically filtered by `stateId`. */
  @Get('cities')
  findCities(@Query() query: ListCityQueryDto) {
    return this.cityService.findAll(query.page ?? 1, query.limit ?? 20, {
      search: query.search,
      stateId: query.stateId,
      countryId: query.countryId,
      isActive: query.isActive,
    });
  }

  /** Fetch one city. */
  @Get('cities/:id')
  findCity(@Param('id') id: string) {
    return this.cityService.findById(id);
  }

  /** List active areas, typically filtered by `cityId`. */
  @Get('areas')
  findAreas(@Query() query: ListAreaQueryDto) {
    return this.areaService.findAll(query.page ?? 1, query.limit ?? 20, {
      search: query.search,
      cityId: query.cityId,
      stateId: query.stateId,
      countryId: query.countryId,
      isActive: query.isActive,
    });
  }

  /** Fetch one area. */
  @Get('areas/:id')
  findArea(@Param('id') id: string) {
    return this.areaService.findById(id);
  }
}
