import { BranchLabPanelList } from '@prisma/client';

/** Domain/response shape for a branch lab panel list (Prisma model is the DB truth). */
export type BranchLabPanelListEntity = BranchLabPanelList;

/** Lightweight option for the referral/registration list selectors. */
export interface BranchLabPanelListOption {
  id: string;
  name: string;
  isDefault: boolean;
}
