import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RadiologyMasterDataModule } from '../radiology-master-data/radiology-master-data.module';
import { RadiologyPanelModule } from '../radiology-panel/radiology-panel.module';
import { RadiologyTestModule } from '../radiology-test/radiology-test.module';
import { BranchRadiologyTestModule } from '../branch-radiology-test/branch-radiology-test.module';
import { BranchRadiologyTestListModule } from '../branch-radiology-test-list/branch-radiology-test-list.module';
import { BranchRadiologyPanelListModule } from '../branch-radiology-panel-list/branch-radiology-panel-list.module';
import { BranchModule } from '../branch/branch.module';
import { BranchRadiologyPanelController } from './branch-radiology-panel.controller';
import { BranchRadiologyPanelOptionsController } from './branch-radiology-panel-options.controller';
import { BranchRadiologyPanelService } from './branch-radiology-panel.service';

/**
 * Branch Radiology Panel List feature module. Materializes independent snapshots of a
 * branch's Master Data radiology panels, materializing their member tests into the
 * branch's Radiology Test List (via `BranchRadiologyTestService`). Imports the
 * radiology master-data, panel, test, branch-test, and both branch-list modules via
 * DI (rule #3). One-way dependencies, so no cycle. Imports `BranchModule` for the
 * Business Admin read route's `branchId` validation.
 */
@Module({
  imports: [
    PrismaModule,
    RadiologyMasterDataModule,
    RadiologyPanelModule,
    RadiologyTestModule,
    BranchRadiologyTestModule,
    BranchRadiologyTestListModule,
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
