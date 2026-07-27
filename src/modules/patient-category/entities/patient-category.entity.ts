import { PatientCategoryDefinition } from '@prisma/client';

/** Domain/response shape for a patient category (the Prisma model is the DB source of truth). */
export type PatientCategoryEntity = PatientCategoryDefinition;

/** A lightweight `{ id, name }` option, used for the mapped Lab Test/Panel List. */
export interface LabListOption {
  id: string;
  name: string;
}

/**
 * A patient category with its active branch's Lab Test List / Lab Panel List
 * resolved to `{ id, name }` options, for the settings table and Edit popup.
 */
export type PatientCategoryWithLists = PatientCategoryEntity & {
  labTests: LabListOption[];
  labPanels: LabListOption[];
};
