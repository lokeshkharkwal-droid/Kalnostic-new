import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { LabTestModule } from '../lab-test/lab-test.module';
import { BranchLabTestController } from './branch-lab-test.controller';
import { BranchLabTestService } from './branch-lab-test.service';

/**
 * Branch Lab Test List feature module. Materializes independent snapshots of a
 * branch's Master Data lab tests and manages them (import/sync/edit/enable/
 * remove). Imports `MasterDataModule` (resolve the branch's 1:1 master data) and
 * `LabTestModule` (compose source tests) via DI (rule #3). Exports the service so
 * `BranchLabPanelModule` can materialize member-test copies with the same
 * semantics.
 */
@Module({
  imports: [PrismaModule, MasterDataModule, LabTestModule],
  controllers: [BranchLabTestController],
  providers: [BranchLabTestService],
  exports: [BranchLabTestService],
})
export class BranchLabTestModule {}
