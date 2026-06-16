import {
  OutsourceCenter,
  OutsourceCenterBranchAssignment,
  OutsourceCenterBranchPanel,
  OutsourceCenterBranchTest,
  OutsourceCenterContact,
} from '@prisma/client';

/** Selects what the list endpoint (`GET /outsource-centers`) returns. */
export enum OutsourceCenterListView {
  DEFAULT = 'DEFAULT',
  CONTACTS = 'CONTACTS',
}

/**
 * A selected lab test on an assignment. `testName`/`testCode` are resolved
 * inline by `findById`; they are optional because `create`/`update` return the
 * same shape without them.
 */
export type OutsourceCenterBranchTestEntity = OutsourceCenterBranchTest & {
  testName?: string | null;
  testCode?: string | null;
};

/**
 * A selected lab panel on an assignment. `panelName`/`panelCode` are resolved
 * inline by `findById`; they are optional because `create`/`update` return the
 * same shape without them.
 */
export type OutsourceCenterBranchPanelEntity = OutsourceCenterBranchPanel & {
  panelName?: string | null;
  panelCode?: string | null;
};

/** A branch assignment with its selected lab tests and lab panels embedded. */
export type OutsourceCenterAssignmentEntity =
  OutsourceCenterBranchAssignment & {
    tests?: OutsourceCenterBranchTestEntity[];
    panels?: OutsourceCenterBranchPanelEntity[];
  };

/**
 * Domain/response shape for an outsource center, optionally with its loaded
 * contacts and branch assignments (each with their selected tests/panels).
 * (The Prisma models are the DB source of truth.)
 */
export type OutsourceCenterEntity = OutsourceCenter & {
  contacts?: OutsourceCenterContact[];
  assignments?: OutsourceCenterAssignmentEntity[];
};
