import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { LabPanelModule } from '../lab-panel/lab-panel.module';
import { LabTestModule } from '../lab-test/lab-test.module';
import { BranchLabTestModule } from '../branch-lab-test/branch-lab-test.module';
import { BranchLabPanelController } from './branch-lab-panel.controller';
import { BranchLabPanelOptionsController } from './branch-lab-panel-options.controller';
import { BranchLabPanelService } from './branch-lab-panel.service';

/**
 * Branch Lab Panel List feature module. Materializes independent snapshots of a
 * branch's Master Data lab panels, materializing their member tests into the
 * branch's Lab Test List (via `BranchLabTestService`). Imports `MasterDataModule`
 * (resolve the branch's master data), `LabPanelModule`/`LabTestModule` (compose
 * source panels + tests), and `BranchLabTestModule` (materialize member-test
 * copies) — all via DI (rule #3). One-way dependencies, so no cycle.
 */
@Module({
  imports: [
    PrismaModule,
    MasterDataModule,
    LabPanelModule,
    LabTestModule,
    BranchLabTestModule,
  ],
  controllers: [BranchLabPanelOptionsController, BranchLabPanelController],
  providers: [BranchLabPanelService],
  exports: [BranchLabPanelService],
})
export class BranchLabPanelModule {}
