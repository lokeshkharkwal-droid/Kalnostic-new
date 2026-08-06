import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchLabPanelListController } from './branch-lab-panel-list.controller';
import { BranchLabPanelListService } from './branch-lab-panel-list.service';

/**
 * Branch **Lab Panel List** feature module — mirror of `BranchLabTestListModule`
 * for panels. Exports the service so `BranchLabPanelModule` (import) and
 * `ReferralListModule` (resolve) can resolve/create the default list via DI.
 */
@Module({
  imports: [PrismaModule],
  controllers: [BranchLabPanelListController],
  providers: [BranchLabPanelListService],
  exports: [BranchLabPanelListService],
})
export class BranchLabPanelListModule {}
