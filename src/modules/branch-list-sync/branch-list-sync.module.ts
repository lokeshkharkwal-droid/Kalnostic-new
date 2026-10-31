import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchLabTestModule } from '../branch-lab-test/branch-lab-test.module';
import { BranchLabPanelModule } from '../branch-lab-panel/branch-lab-panel.module';
import { BranchListSyncJobService } from './branch-list-sync-job.service';
import { BranchLabTestSyncController } from './branch-lab-test-sync.controller';
import { BranchLabPanelSyncController } from './branch-lab-panel-sync.controller';

/**
 * Background "Sync from Master Data" jobs for a branch's Lab Test / Lab Panel List
 * (reconcile the list against Branch Master Data — add/update/delete) so the
 * branch-admin dialog can poll live progress. Imports both branch-list modules (it
 * sits above them in the graph and nothing imports this module, so no cycle) to
 * inject their services via DI (rule #3). The job logic lives in
 * {@link BranchListSyncJobService}; two controllers expose it per list kind.
 */
@Module({
  imports: [PrismaModule, BranchLabTestModule, BranchLabPanelModule],
  controllers: [BranchLabTestSyncController, BranchLabPanelSyncController],
  providers: [BranchListSyncJobService],
})
export class BranchListSyncModule {}
