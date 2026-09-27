import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OpdMasterDataModule } from '../opd-master-data/opd-master-data.module';
import { OpdPanelModule } from '../opd-panel/opd-panel.module';
import { OpdTestModule } from '../opd-test/opd-test.module';
import { BranchOpdTestModule } from '../branch-opd-test/branch-opd-test.module';
import { BranchOpdTestListModule } from '../branch-opd-test-list/branch-opd-test-list.module';
import { BranchOpdPanelListModule } from '../branch-opd-panel-list/branch-opd-panel-list.module';
import { BranchModule } from '../branch/branch.module';
import { BranchOpdPanelController } from './branch-opd-panel.controller';
import { BranchOpdPanelOptionsController } from './branch-opd-panel-options.controller';
import { BranchOpdPanelService } from './branch-opd-panel.service';

/**
 * Branch Opd Panel List feature module. Materializes independent snapshots of a
 * branch's Master Data opd panels, materializing their member tests into the
 * branch's Opd Test List (via `BranchOpdTestService`). Imports the
 * opd master-data, panel, test, branch-test, and both branch-list modules via
 * DI (rule #3). One-way dependencies, so no cycle. Imports `BranchModule` for the
 * Business Admin read route's `branchId` validation.
 */
@Module({
  imports: [
    PrismaModule,
    OpdMasterDataModule,
    OpdPanelModule,
    OpdTestModule,
    BranchOpdTestModule,
    BranchOpdTestListModule,
    BranchOpdPanelListModule,
    BranchModule,
  ],
  controllers: [BranchOpdPanelOptionsController, BranchOpdPanelController],
  providers: [BranchOpdPanelService],
  exports: [BranchOpdPanelService],
})
export class BranchOpdPanelModule {}
