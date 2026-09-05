import { ReferralType } from '@prisma/client';

/**
 * The pricing lists resolved for an order. `source` is the referral type whose
 * assignment matched, `PT_CATEGORY` when a selected PT category's mapped items'
 * lists won, or `DEFAULT` when the branch's Walk-in lists were used. List ids are
 * null only when the branch has no default list yet (never imported).
 */
export interface ResolvedLists {
  branchLabTestListId: string | null;
  branchLabPanelListId: string | null;
  source: ReferralType | 'PT_CATEGORY' | 'DEFAULT';
}

/** The lists a caller wants to attach to a referral (either may be null/absent). */
export interface ReferralListSelection {
  branchLabTestListId?: string | null;
  branchLabPanelListId?: string | null;
}

/** A `{ id, name }` reference to a named Lab Test List / Lab Panel List. */
export interface LabListRef {
  id: string;
  name: string;
}

/** A referral's bulk-resolved list assignment, as merged onto a list-item row. */
export interface ReferralListAssignmentView {
  labTestList: LabListRef | null;
  labPanelList: LabListRef | null;
}
