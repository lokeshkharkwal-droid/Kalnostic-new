import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { RadiologyTestController } from './radiology-test.controller';
import { RadiologyTestOptionsController } from './radiology-test-options.controller';
import { SiteAdminRadiologyTestController } from './siteadmin-radiology-test.controller';
import { RadiologyTestService } from './radiology-test.service';

/**
 * Radiology Test feature module. Tenant-scoped + branch-level radiology-test
 * configuration living inside a master data. The radiology model is FLAT (no
 * samples/result-params/reference ranges), so — unlike `LabTestModule` — there
 * is no `LabTestSettingsModule` import (radiology has no image/pdf settings). It
 * imports `MasterDataModule` to validate the parent master data via
 * `MasterDataService` (rule #3 — DI, not a direct file import); one-way
 * dependency, so no cycle. Exports the service so the branch-radiology-test
 * module can read source tests with the same semantics.
 */
@Module({
  imports: [PrismaModule, MasterDataModule],
  controllers: [
    RadiologyTestController,
    RadiologyTestOptionsController,
    SiteAdminRadiologyTestController,
  ],
  providers: [RadiologyTestService],
  exports: [RadiologyTestService],
})
export class RadiologyTestModule {}
