import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { BranchRadiologyPanelListController } from './branch-radiology-panel-list.controller';
import { BranchRadiologyPanelListService } from './branch-radiology-panel-list.service';

/**
 * Branch **Radiology Panel List** feature module. Manages a branch's named pricing
 * lists for panels, each owning full copies of its radiology-panel rows (+ member
 * tests). Exports the service so `BranchRadiologyPanelModule` can resolve/create the
 * default list via DI (rule #3). Imports `BranchModule` for the Business Admin read
 * route's `branchId` validation.
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [BranchRadiologyPanelListController],
  providers: [BranchRadiologyPanelListService],
  exports: [BranchRadiologyPanelListService],
})
export class BranchRadiologyPanelListModule {}
