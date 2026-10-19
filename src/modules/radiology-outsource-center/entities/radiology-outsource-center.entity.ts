import { RadiologyOutsourceCenter } from '@prisma/client';

/**
 * Domain/response shape for a radiology outsource center. Unlike `OutsourceCenter`
 * this model has NO contacts/documents child tables. The selected
 * `radiologyTestId`/`radiologyPanelId` and assigned
 * `branchRadiologyTestListId`/`branchRadiologyPanelListId` are resolved inline to
 * their names (left `null` if the referenced row has since been deleted). (The
 * Prisma model is the DB source of truth.)
 */
export type RadiologyOutsourceCenterEntity = RadiologyOutsourceCenter & {
  radiologyTestName?: string | null;
  radiologyPanelName?: string | null;
  branchRadiologyTestListName?: string | null;
  branchRadiologyPanelListName?: string | null;
};
