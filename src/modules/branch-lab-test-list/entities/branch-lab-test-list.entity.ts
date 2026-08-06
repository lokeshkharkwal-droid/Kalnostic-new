import { BranchLabTestList } from '@prisma/client';

/** Domain/response shape for a branch lab test list (Prisma model is the DB truth). */
export type BranchLabTestListEntity = BranchLabTestList;

/** Lightweight option for the referral/registration list selectors. */
export interface BranchLabTestListOption {
  id: string;
  name: string;
  isDefault: boolean;
}
