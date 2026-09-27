import { BranchOpdPanelList } from '@prisma/client';

/** Domain/response shape for a branch opd panel list (Prisma model is the DB truth). */
export type BranchOpdPanelListEntity = BranchOpdPanelList;

/** Lightweight option for the list selectors. */
export interface BranchOpdPanelListOption {
  id: string;
  name: string;
  isDefault: boolean;
}
