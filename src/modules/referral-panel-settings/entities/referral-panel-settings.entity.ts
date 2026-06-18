import { ReferralPanelSettings } from '@prisma/client';

/**
 * Domain/response shape for a referral panel settings template. The Prisma model
 * is the DB source of truth; money fields are `Decimal` columns (serialised as
 * strings by Prisma) and `clientType`/`status`/`bonusType` are enums.
 */
export type ReferralPanelSettingsEntity = ReferralPanelSettings;
