import { Equipment } from '@prisma/client';

/** A mapped lab test embedded in an equipment read (a lightweight projection). */
export interface EquipmentLabTest {
  id: string;
  testName: string;
  testCode: string;
}

/**
 * An equipment composed with its mapped SITE_ADMIN lab tests — the get-one /
 * create / update response shape.
 */
export type EquipmentWithTests = Equipment & {
  labTests: EquipmentLabTest[];
};

/**
 * One row of the equipment listing endpoint: the equipment id, its name and
 * code, and the count of active mapped lab tests.
 */
export interface EquipmentListRow {
  id: string;
  name: string;
  code: string | null;
  labTestsCount: number;
}
