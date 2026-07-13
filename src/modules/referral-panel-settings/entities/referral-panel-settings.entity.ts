import { ReferralPanelSettings } from '@prisma/client';

/**
 * Domain/response shape for a referral panel settings template. The Prisma model
 * is the DB source of truth; money fields are `Decimal` columns (serialised as
 * strings by Prisma) and `clientType`/`status`/`bonusType` are enums.
 */
export type ReferralPanelSettingsEntity = ReferralPanelSettings;

/**
 * Response shape enriched with the creator's display name. `createdBy` stores a
 * bare `person_id`; `createdByName` is that person's resolved full name (or null
 * when the creator is unknown/deleted) so the UI never has to show a raw uuid.
 */
export type ReferralPanelSettingsWithCreator = ReferralPanelSettingsEntity & {
  createdByName: string | null;
};
