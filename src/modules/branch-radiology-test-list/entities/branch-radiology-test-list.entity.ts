import { BranchRadiologyTestList } from '@prisma/client';

/** Domain/response shape for a branch radiology test list (Prisma model is the DB truth). */
export type BranchRadiologyTestListEntity = BranchRadiologyTestList;

/** Lightweight option for the referral/registration list selectors. */
export interface BranchRadiologyTestListOption {
  id: string;
  name: string;
  isDefault: boolean;
}
