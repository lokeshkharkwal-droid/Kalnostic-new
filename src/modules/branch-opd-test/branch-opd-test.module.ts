import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OpdMasterDataModule } from '../opd-master-data/opd-master-data.module';
import { OpdTestModule } from '../opd-test/opd-test.module';
import { BranchOpdTestListModule } from '../branch-opd-test-list/branch-opd-test-list.module';
import { BranchModule } from '../branch/branch.module';
import { BranchOpdTestController } from './branch-opd-test.controller';
import { BranchOpdTestOptionsController } from './branch-opd-test-options.controller';
import { BranchOpdTestService } from './branch-opd-test.service';

/**
 * Branch Opd Test List feature module. Materializes independent snapshots of a
 * branch's Master Data opd tests and manages them (import/sync/edit/enable/
 * remove). Imports `OpdMasterDataModule`, `OpdTestModule`, and
 * `BranchOpdTestListModule` via DI (rule #3). Exports the service so
 * `BranchOpdPanelModule` can materialize member-test copies. Imports
 * `BranchModule` for the Business Admin read route's `branchId` validation.
 */
@Module({
  imports: [
    PrismaModule,
    OpdMasterDataModule,
    OpdTestModule,
    BranchOpdTestListModule,
    BranchModule,
  ],
  controllers: [BranchOpdTestOptionsController, BranchOpdTestController],
  providers: [BranchOpdTestService],
  exports: [BranchOpdTestService],
})
export class BranchOpdTestModule {}
