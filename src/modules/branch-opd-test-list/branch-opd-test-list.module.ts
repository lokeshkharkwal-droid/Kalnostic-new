import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { BranchOpdTestListController } from './branch-opd-test-list.controller';
import { BranchOpdTestListService } from './branch-opd-test-list.service';

/**
 * Branch **Opd Test List** feature module. Manages a branch's named pricing
 * lists (Walk-in, …), each owning full copies of its opd-test rows. Exports
 * the service so `BranchOpdTestModule` can resolve/create the default list via
 * DI (rule #3). Imports `BranchModule` so the Business Admin read route can
 * validate a caller-supplied `branchId`.
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [BranchOpdTestListController],
  providers: [BranchOpdTestListService],
  exports: [BranchOpdTestListService],
})
export class BranchOpdTestListModule {}
