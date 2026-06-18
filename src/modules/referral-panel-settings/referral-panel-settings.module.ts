import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReferralPanelSettingsController } from './referral-panel-settings.controller';
import { ReferralPanelSettingsService } from './referral-panel-settings.service';

/**
 * Referral-panel-settings feature module. Tenant-scoped, tenant-level (CLAUDE.md
 * §4.6). Imports only `PrismaModule`; exports `ReferralPanelSettingsService` so the
 * four referral modules (panel/doctor/external/internal) can validate a referenced
 * `referralPanelSettingsId` against the tenant (CLAUDE.md rule #3 — DI, not a direct
 * file import).
 */
@Module({
  imports: [PrismaModule],
  controllers: [ReferralPanelSettingsController],
  providers: [ReferralPanelSettingsService],
  exports: [ReferralPanelSettingsService],
})
export class ReferralPanelSettingsModule {}
