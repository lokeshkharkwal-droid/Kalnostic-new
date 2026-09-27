import { BranchOpdTestList } from '@prisma/client';

/** Domain/response shape for a branch opd test list (Prisma model is the DB truth). */
export type BranchOpdTestListEntity = BranchOpdTestList;

/** Lightweight option for the list selectors. */
export interface BranchOpdTestListOption {
  id: string;
  name: string;
  isDefault: boolean;
}
