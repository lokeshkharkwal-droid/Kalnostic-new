import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { BranchRadiologyTestListController } from './branch-radiology-test-list.controller';
import { BranchRadiologyTestListService } from './branch-radiology-test-list.service';

/**
 * Branch **Radiology Test List** feature module. Manages a branch's named pricing
 * lists (Walk-in, …), each owning full copies of its radiology-test rows. Exports
 * the service so `BranchRadiologyTestModule` can resolve/create the default list via
 * DI (rule #3). Imports `BranchModule` so the Business Admin read route can
 * validate a caller-supplied `branchId`.
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [BranchRadiologyTestListController],
  providers: [BranchRadiologyTestListService],
  exports: [BranchRadiologyTestListService],
})
export class BranchRadiologyTestListModule {}
