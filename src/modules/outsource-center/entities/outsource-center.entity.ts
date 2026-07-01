import { OutsourceCenter, OutsourceCenterContact } from '@prisma/client';

/** Selects what the list endpoint (`GET /outsource-centers`) returns. */
export enum OutsourceCenterListView {
  DEFAULT = 'DEFAULT',
  CONTACTS = 'CONTACTS',
}

/**
 * Domain/response shape for an outsource center, optionally with its loaded
 * contacts. `labTestName` / `labPanelName` are resolved inline from the single
 * `labTestId` / `labPanelId` (left `null` if the referenced test/panel has since
 * been deleted). (The Prisma models are the DB source of truth.)
 */
export type OutsourceCenterEntity = OutsourceCenter & {
  contacts?: OutsourceCenterContact[];
  labTestName?: string | null;
  labPanelName?: string | null;
};
