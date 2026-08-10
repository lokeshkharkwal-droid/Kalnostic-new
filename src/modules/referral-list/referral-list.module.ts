import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PtCategoryModule } from '../pt-category/pt-category.module';
import { ReferralListController } from './referral-list.controller';
import { ReferralListAssignmentService } from './referral-list-assignment.service';

/**
 * Referral → pricing-list mapping module. Owns the per-branch
 * `ReferralListAssignment` (upsert + resolve) and the Create-Order resolve
 * endpoint. Imports `PtCategoryModule` so the resolver can fold a selected PT
 * category into the pricing chain (rule #3). Exports the service so the four
 * referral modules and `OrderModule` can wire it via DI.
 */
@Module({
  imports: [PrismaModule, PtCategoryModule],
  controllers: [ReferralListController],
  providers: [ReferralListAssignmentService],
  exports: [ReferralListAssignmentService],
})
export class ReferralListModule {}
