import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { BranchOpdPanelListController } from './branch-opd-panel-list.controller';
import { BranchOpdPanelListService } from './branch-opd-panel-list.service';

/**
 * Branch **Opd Panel List** feature module. Manages a branch's named pricing
 * lists for panels, each owning full copies of its opd-panel rows (+ member
 * tests). Exports the service so `BranchOpdPanelModule` can resolve/create the
 * default list via DI (rule #3). Imports `BranchModule` for the Business Admin read
 * route's `branchId` validation.
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [BranchOpdPanelListController],
  providers: [BranchOpdPanelListService],
  exports: [BranchOpdPanelListService],
})
export class BranchOpdPanelListModule {}
