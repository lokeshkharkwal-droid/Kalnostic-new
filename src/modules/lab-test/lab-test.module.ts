import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { LabTestController } from './lab-test.controller';
import { LabTestOptionsController } from './lab-test-options.controller';
import { SiteAdminLabTestController } from './siteadmin-lab-test.controller';
import { LabTestService } from './lab-test.service';

/**
 * Lab Test feature module. Tenant-scoped + branch-level lab-test configuration
 * (the test plus its samples, result parameters, and reference ranges/values),
 * living inside a master data. Imports `MasterDataModule` to validate the parent
 * master data via `MasterDataService` (rule #3 — DI, not a direct file import);
 * one-way dependency, so no cycle.
 */
@Module({
  imports: [PrismaModule, MasterDataModule],
  controllers: [
    LabTestController,
    LabTestOptionsController,
    SiteAdminLabTestController,
  ],
  providers: [LabTestService],
  exports: [LabTestService],
})
export class LabTestModule {}
