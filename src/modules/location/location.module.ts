import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CountryService } from './country.service';
import { StateService } from './state.service';
import { CityService } from './city.service';
import { AreaService } from './area.service';
import { SiteAdminCountryController } from './siteadmin-country.controller';
import { SiteAdminStateController } from './siteadmin-state.controller';
import { SiteAdminCityController } from './siteadmin-city.controller';
import { SiteAdminAreaController } from './siteadmin-area.controller';
import { LocationController } from './location.controller';

/**
 * Location master module. Platform-level (no tenant scoping, no RLS) — a global
 * Country → State → City → Area/Locality hierarchy maintained by SiteAdmin and
 * consumed read-only by business users. The four services are co-located here so
 * child services can inject their parents for FK validation via the module's
 * `providers` (CLAUDE.md rule #3 — never import another service directly):
 * `StateService`←`CountryService`, `CityService`←`StateService`+`CountryService`,
 * `AreaService`←`CityService`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    SiteAdminCountryController,
    SiteAdminStateController,
    SiteAdminCityController,
    SiteAdminAreaController,
    LocationController,
  ],
  providers: [CountryService, StateService, CityService, AreaService],
  exports: [CountryService, StateService, CityService, AreaService],
})
export class LocationModule {}
