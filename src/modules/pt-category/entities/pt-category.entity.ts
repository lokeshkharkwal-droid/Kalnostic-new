import { PtCategory } from '@prisma/client';

/** Domain/response shape for a PT category (the Prisma model is the DB source of truth). */
export type PtCategoryEntity = PtCategory;

/** A lightweight `{ id, name }` reference to a mapped Lab Test List / Lab Panel List. */
export interface MappedList {
  id: string;
  name: string;
}

/**
 * A PT category with its mapped Lab Test List / Lab Panel List resolved to
 * `{ id, name }` (or null when unmapped), for the settings table and Edit popup.
 */
export type PtCategoryWithMappings = PtCategoryEntity & {
  branchLabTestList: MappedList | null;
  branchLabPanelList: MappedList | null;
};

/** The pricing lists a PT category resolves to (its own mapped list ids). */
export interface PtCategoryResolvedLists {
  branchLabTestListId: string | null;
  branchLabPanelListId: string | null;
}

/** The active default PT category for a branch (Create-Order auto-select). */
export interface PtCategoryDefault {
  id: string;
  categoryName: string;
}
