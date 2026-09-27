import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RadiologyMasterDataModule } from '../radiology-master-data/radiology-master-data.module';
import { RadiologyTestModule } from '../radiology-test/radiology-test.module';
import { BranchRadiologyTestListModule } from '../branch-radiology-test-list/branch-radiology-test-list.module';
import { BranchModule } from '../branch/branch.module';
import { BranchRadiologyTestController } from './branch-radiology-test.controller';
import { BranchRadiologyTestOptionsController } from './branch-radiology-test-options.controller';
import { BranchRadiologyTestService } from './branch-radiology-test.service';

/**
 * Branch Radiology Test List feature module. Materializes independent snapshots of a
 * branch's Master Data radiology tests and manages them (import/sync/edit/enable/
 * remove). Imports `RadiologyMasterDataModule`, `RadiologyTestModule`, and
 * `BranchRadiologyTestListModule` via DI (rule #3). Exports the service so
 * `BranchRadiologyPanelModule` can materialize member-test copies. Imports
 * `BranchModule` for the Business Admin read route's `branchId` validation.
 */
@Module({
  imports: [
    PrismaModule,
    RadiologyMasterDataModule,
    RadiologyTestModule,
    BranchRadiologyTestListModule,
    BranchModule,
  ],
  controllers: [
    BranchRadiologyTestOptionsController,
    BranchRadiologyTestController,
  ],
  providers: [BranchRadiologyTestService],
  exports: [BranchRadiologyTestService],
})
export class BranchRadiologyTestModule {}
