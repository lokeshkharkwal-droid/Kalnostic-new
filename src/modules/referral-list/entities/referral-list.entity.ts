import { ReferralType } from '@prisma/client';

/**
 * The pricing lists resolved for an order. `source` is the referral type whose
 * assignment matched, or `DEFAULT` when the branch's Walk-in lists were used.
 * List ids are null only when the branch has no default list yet (never imported).
 */
export interface ResolvedLists {
  branchLabTestListId: string | null;
  branchLabPanelListId: string | null;
  source: ReferralType | 'DEFAULT';
}

/** The lists a caller wants to attach to a referral (either may be null/absent). */
export interface ReferralListSelection {
  branchLabTestListId?: string | null;
  branchLabPanelListId?: string | null;
}
