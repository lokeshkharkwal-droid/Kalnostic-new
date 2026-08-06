import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReferralListController } from './referral-list.controller';
import { ReferralListAssignmentService } from './referral-list-assignment.service';

/**
 * Referral → pricing-list mapping module. Owns the per-branch
 * `ReferralListAssignment` (upsert + resolve) and the Create-Order resolve
 * endpoint. Exports the service so the four referral modules and `OrderModule`
 * can wire it via DI (rule #3).
 */
@Module({
  imports: [PrismaModule],
  controllers: [ReferralListController],
  providers: [ReferralListAssignmentService],
  exports: [ReferralListAssignmentService],
})
export class ReferralListModule {}
