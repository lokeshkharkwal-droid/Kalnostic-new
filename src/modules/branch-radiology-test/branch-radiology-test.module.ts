import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { BranchRadiologyTestListModule } from '../branch-radiology-test-list/branch-radiology-test-list.module';
import { BranchModule } from '../branch/branch.module';
import { BranchRadiologyTestController } from './branch-radiology-test.controller';
import { BranchRadiologyTestOptionsController } from './branch-radiology-test-options.controller';
import { BranchRadiologyTestService } from './branch-radiology-test.service';

/**
 * Branch Radiology Test List feature module. Materializes independent snapshots
 * of a branch's Master Data radiology tests and manages them (import/sync/edit/
 * enable/remove). The radiology model is FLAT, so there are no clinical children
 * to snapshot — the service reads `RadiologyTest` master rows directly via Prisma
 * (no `RadiologyTestService` dependency). Imports `MasterDataModule` (resolve the
 * branch's 1:1 master data), `BranchRadiologyTestListModule` (resolve/create the
 * default Walk-in list) and `BranchModule` (validate a caller-supplied
 * `branchId`) via DI (rule #3).
 */
@Module({
  imports: [
    PrismaModule,
    MasterDataModule,
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
