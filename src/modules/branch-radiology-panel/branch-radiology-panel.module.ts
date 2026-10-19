import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { BranchRadiologyPanelListModule } from '../branch-radiology-panel-list/branch-radiology-panel-list.module';
import { BranchModule } from '../branch/branch.module';
import { BranchRadiologyPanelController } from './branch-radiology-panel.controller';
import { BranchRadiologyPanelOptionsController } from './branch-radiology-panel-options.controller';
import { BranchRadiologyPanelService } from './branch-radiology-panel.service';

/**
 * Branch Radiology Panel List feature module. Materializes independent snapshots
 * of a branch's Master Data radiology panels, rebuilding each panel's member tests
 * against the branch's own `BranchRadiologyTest` copies (matched by
 * `sourceRadiologyTestId`; members with no branch copy are skipped). Reads
 * `RadiologyPanel`/`RadiologyPanelTest` master rows directly via Prisma (no
 * `RadiologyPanelService` dependency). Imports `MasterDataModule` (resolve the
 * branch's 1:1 master data), `BranchRadiologyPanelListModule` (resolve/create the
 * default Walk-in panel list) and `BranchModule` (validate a caller-supplied
 * `branchId`) via DI (rule #3). One-way dependencies, so no cycle.
 */
@Module({
  imports: [
    PrismaModule,
    MasterDataModule,
    BranchRadiologyPanelListModule,
    BranchModule,
  ],
  controllers: [
    BranchRadiologyPanelOptionsController,
    BranchRadiologyPanelController,
  ],
  providers: [BranchRadiologyPanelService],
  exports: [BranchRadiologyPanelService],
})
export class BranchRadiologyPanelModule {}
