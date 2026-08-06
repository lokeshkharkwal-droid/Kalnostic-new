import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchLabTestListController } from './branch-lab-test-list.controller';
import { BranchLabTestListService } from './branch-lab-test-list.service';

/**
 * Branch **Lab Test List** feature module. Manages a branch's named pricing lists
 * (Walk-in, B2B Corporate, …), each owning full copies of its lab-test rows.
 * Exports the service so `BranchLabTestModule` (import) and `ReferralListModule`
 * (resolve) can resolve/create the default list via DI (rule #3).
 */
@Module({
  imports: [PrismaModule],
  controllers: [BranchLabTestListController],
  providers: [BranchLabTestListService],
  exports: [BranchLabTestListService],
})
export class BranchLabTestListModule {}
