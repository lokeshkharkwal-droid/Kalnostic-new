import { BranchRadiologyPanelList } from '@prisma/client';

/** Domain/response shape for a branch radiology panel list (Prisma model is the DB truth). */
export type BranchRadiologyPanelListEntity = BranchRadiologyPanelList;

/** Lightweight option for the list selectors. */
export interface BranchRadiologyPanelListOption {
  id: string;
  name: string;
  isDefault: boolean;
}
