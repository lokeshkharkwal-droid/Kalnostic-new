import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RadiologyMasterDataModule } from '../radiology-master-data/radiology-master-data.module';
import { RadiologyTestController } from './radiology-test.controller';
import { RadiologyTestOptionsController } from './radiology-test-options.controller';
import { SiteAdminRadiologyTestController } from './siteadmin-radiology-test.controller';
import { RadiologyTestService } from './radiology-test.service';

/**
 * Radiology Test feature module. Tenant-scoped + branch-level radiology-test
 * configuration (the test plus its samples, result parameters, and reference
 * ranges/values), living inside a radiology master data. Imports
 * `RadiologyMasterDataModule` to validate the parent master data via
 * `RadiologyMasterDataService` (rule #3 — DI, not a direct file import).
 */
@Module({
  imports: [PrismaModule, RadiologyMasterDataModule],
  controllers: [
    RadiologyTestOptionsController,
    RadiologyTestController,
    SiteAdminRadiologyTestController,
  ],
  providers: [RadiologyTestService],
  exports: [RadiologyTestService],
})
export class RadiologyTestModule {}
