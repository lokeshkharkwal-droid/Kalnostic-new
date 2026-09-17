import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReferralUsageService } from './referral-usage.service';

/**
 * Small shared provider module: exports `ReferralUsageService` so all four
 * referral feature modules (referral-panel, referral-doctor, internal-referral,
 * external-referral) can check whether a referral is still used by an
 * active-workflow order — without importing each other's services (CLAUDE.md
 * rule #3). Depends only on `PrismaModule`, so it adds no coupling weight.
 */
@Module({
  imports: [PrismaModule],
  providers: [ReferralUsageService],
  exports: [ReferralUsageService],
})
export class ReferralUsageModule {}
