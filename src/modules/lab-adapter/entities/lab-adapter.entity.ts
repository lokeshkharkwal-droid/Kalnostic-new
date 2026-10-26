import { AdapterStatus, LabAdapter } from '@prisma/client';

/** A branch assigned to an adapter (resolved with its name for reads). */
export interface LabAdapterBranchRef {
  branchId: string;
  branchName: string;
}

/** A branch lab test mapped to an adapter (a lightweight projection). */
export interface LabAdapterLabTestRef {
  id: string;
  /** The branch this test copy belongs to (each branch has its own copy). */
  branchId: string;
  testName: string;
  testCode: string | null;
}

/** The equipment an adapter references (a lightweight projection). */
export interface LabAdapterEquipmentRef {
  id: string;
  name: string;
  code: string | null;
}

/**
 * A lab adapter composed with its referenced equipment, assigned branches, and
 * mapped branch lab tests — the get-one / create / update response shape.
 */
export type LabAdapterWithRelations = LabAdapter & {
  equipment: LabAdapterEquipmentRef | null;
  branches: LabAdapterBranchRef[];
  labTests: LabAdapterLabTestRef[];
};

/**
 * One row of the lab-adapter listing endpoint: identity, token, status, the
 * referenced equipment name, and the counts of assigned branches / mapped tests.
 */
export interface LabAdapterListRow {
  id: string;
  name: string;
  token: string;
  status: AdapterStatus;
  equipmentName: string | null;
  branchCount: number;
  labTestsCount: number;
}

/** A lightweight adapter option row for the Analyzer selector (Adapter-wise
 * reference ranges). */
export interface LabAdapterOption {
  id: string;
  name: string;
}

/**
 * A lab-test option row for the adapter form's manual Lab Tests picker. One row per
 * **test** (not per branch copy): `id` is one copy's id (the first selected branch that
 * has it) and `branchIds` lists every selected branch that has a copy. Saving a pick
 * links all of its copies at the adapter's branches. `hint` says where it applies when
 * several branches are selected.
 */
export interface LabAdapterLabTestOption {
  id: string;
  name: string;
  /** The branch of the copy `id` belongs to. */
  branchId: string;
  /** Every selected branch that has a copy of this test. */
  branchIds: string[];
  hint?: string;
}
