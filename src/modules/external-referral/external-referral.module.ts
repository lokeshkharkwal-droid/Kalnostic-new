import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { ReferralPanelSettingsModule } from '../referral-panel-settings/referral-panel-settings.module';
import { ExternalReferralController } from './external-referral.controller';
import { ExternalReferralService } from './external-referral.service';

/**
 * External-referral feature module. Tenant-scoped, tenant-level (CLAUDE.md §4.6) —
 * manages a business's registry of external referral partners and their
 * commission/incentive config and assigned lab tests/panels. Assigned lab-test/panel
 * references are validated against the `LabTest`/`LabPanel` models directly via
 * `PrismaService`. Imports `ReferralPanelSettingsModule` to validate a referenced
 * `referralPanelSettingsId` against the tenant via the exported service (CLAUDE.md
 * rule #3). Exports `ExternalReferralService` for future modules.
 */
@Module({
  imports: [PrismaModule, BranchModule, ReferralPanelSettingsModule],
  controllers: [ExternalReferralController],
  providers: [ExternalReferralService],
  exports: [ExternalReferralService],
})
export class ExternalReferralModule {}
