import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { UsersModule } from '../users/users.module';
import { ReferralPanelSettingsModule } from '../referral-panel-settings/referral-panel-settings.module';
import { InternalReferralController } from './internal-referral.controller';
import { InternalReferralService } from './internal-referral.service';

/**
 * Internal-referral feature module. Tenant-scoped, tenant-level (CLAUDE.md §4.6) —
 * manages a business's registry of internal referrals (employees who refer lab work)
 * with their commission/incentive + payroll config and assigned lab tests/panels.
 * Imports `UsersModule` to validate an optional employee link via the exported
 * `UsersService` (CLAUDE.md rule #3 — never import another service directly).
 * Assigned lab-test/panel references are validated against the `LabTest`/`LabPanel`
 * models directly via `PrismaService`. Exports `InternalReferralService` for future
 * modules.
 */
@Module({
  imports: [
    PrismaModule,
    BranchModule,
    UsersModule,
    ReferralPanelSettingsModule,
  ],
  controllers: [InternalReferralController],
  providers: [InternalReferralService],
  exports: [InternalReferralService],
})
export class InternalReferralModule {}
