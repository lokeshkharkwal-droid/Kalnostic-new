import {
  ReferralPanel,
  ReferralPanelLabPanel,
  ReferralPanelLabTest,
} from '@prisma/client';

/**
 * One slab-based commission row as stored in `ReferralPanel.commissionSlabs`
 * (JSON). Declared as a `type` (not an interface) so it carries an implicit index
 * signature and is assignable to Prisma's `InputJsonValue` on writes.
 */
export type CommissionSlab = {
  monthlyBusinessFrom: number;
  monthlyBusinessTo: number;
  commissionPct: number;
};

/** One incentive-bonus row as stored in `ReferralPanel.bonusSlabs` (JSON). */
export type BonusSlab = {
  monthlyBusinessFrom: number;
  monthlyBusinessTo: number;
  bonusPct: number;
};

/**
 * An assigned lab test on a referral panel. `testName`/`testCode` are resolved
 * inline by `findById`; optional because `create`/`update` may return the row
 * without them.
 */
export type ReferralPanelLabTestEntity = ReferralPanelLabTest & {
  testName?: string | null;
  testCode?: string | null;
};

/** An assigned lab panel on a referral panel, enriched by `findById`. */
export type ReferralPanelLabPanelEntity = ReferralPanelLabPanel & {
  panelName?: string | null;
  panelCode?: string | null;
};

/**
 * Domain/response shape for a referral panel, optionally with its loaded assigned
 * lab tests and lab panels. (The Prisma model is the DB source of truth;
 * `commissionSlabs`/`bonusSlabs` are JSON columns holding `CommissionSlab[]` /
 * `BonusSlab[]`.)
 */
export type ReferralPanelEntity = ReferralPanel & {
  labTests?: ReferralPanelLabTestEntity[];
  labPanels?: ReferralPanelLabPanelEntity[];
};

/** A reference to an assigned lab test/panel (id + resolved name). */
export interface LabRef {
  id: string;
  name: string;
}

/**
 * The list endpoint response: the full panel row plus the assigned lab test/panel
 * references (`[{ id, name }]`), resolved by the service.
 */
export type ReferralPanelListItem = ReferralPanel & {
  labTestList: LabRef[];
  labPanelList: LabRef[];
};
