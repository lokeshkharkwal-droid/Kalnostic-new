import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { BranchRadiologyPanelListController } from './branch-radiology-panel-list.controller';
import { BranchRadiologyPanelListService } from './branch-radiology-panel-list.service';

/**
 * Branch **Radiology Panel List** feature module — mirror of
 * `BranchRadiologyTestListModule` for panels. Manages a branch's named pricing
 * lists (Walk-in, …), each owning full copies of its radiology-panel rows plus
 * their member tests. Exports the service so `BranchRadiologyPanelModule`
 * (import) can resolve/create the default list via DI (rule #3). Imports
 * `BranchModule` so the controller's Business Admin read route can validate a
 * caller-supplied `branchId` belongs to the tenant before using it.
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [BranchRadiologyPanelListController],
  providers: [BranchRadiologyPanelListService],
  exports: [BranchRadiologyPanelListService],
})
export class BranchRadiologyPanelListModule {}
