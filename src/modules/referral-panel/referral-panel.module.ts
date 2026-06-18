import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { ReferralPanelSettingsModule } from '../referral-panel-settings/referral-panel-settings.module';
import { ReferralPanelController } from './referral-panel.controller';
import { ReferralPanelService } from './referral-panel.service';

/**
 * Referral-panel feature module. Tenant-scoped, tenant-level (CLAUDE.md §4.6).
 * Assigned lab-test/panel references are validated against the `LabTest`/`LabPanel`
 * models directly via `PrismaService`. Imports `ReferralPanelSettingsModule` to
 * validate a referenced `referralPanelSettingsId` against the tenant via the
 * exported service (CLAUDE.md rule #3). Exports `ReferralPanelService` for future
 * modules (e.g. order/commission settlement).
 */
@Module({
  imports: [PrismaModule, BranchModule, ReferralPanelSettingsModule],
  controllers: [ReferralPanelController],
  providers: [ReferralPanelService],
  exports: [ReferralPanelService],
})
export class ReferralPanelModule {}
