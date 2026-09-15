import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { BranchLabPanelListController } from './branch-lab-panel-list.controller';
import { BranchLabPanelListService } from './branch-lab-panel-list.service';

/**
 * Branch **Lab Panel List** feature module — mirror of `BranchLabTestListModule`
 * for panels. Exports the service so `BranchLabPanelModule` (import) and
 * `ReferralListModule` (resolve) can resolve/create the default list via DI.
 * Imports `BranchModule` so the controller's Business Admin read route can
 * validate a caller-supplied `branchId` belongs to the tenant before using it.
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [BranchLabPanelListController],
  providers: [BranchLabPanelListService],
  exports: [BranchLabPanelListService],
})
export class BranchLabPanelListModule {}
