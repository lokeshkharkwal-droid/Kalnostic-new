import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReferralCreditService } from './referral-credit.service';

/**
 * Cross-cutting credit-enforcement for Referral Panel Settings (Section 4).
 * Depends only on `PrismaModule` (it computes referral outstanding directly via
 * Prisma), so it can be imported by both `OrderModule` and `LabReportModule`
 * without any circular dependency. Exports `ReferralCreditService` so those
 * modules inject it (CLAUDE.md rule #3 — DI, not a direct file import).
 */
@Module({
  imports: [PrismaModule],
  providers: [ReferralCreditService],
  exports: [ReferralCreditService],
})
export class ReferralCreditModule {}
