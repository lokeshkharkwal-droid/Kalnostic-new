import { LabAdapter } from '@prisma/client';

/** A branch assigned to an adapter (resolved with its name for reads). */
export interface LabAdapterBranchRef {
  branchId: string;
  branchName: string;
}

/** A branch lab test mapped to an adapter (a lightweight projection). */
export interface LabAdapterLabTestRef {
  id: string;
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
  isActive: boolean;
  equipmentName: string | null;
  branchCount: number;
  labTestsCount: number;
}
