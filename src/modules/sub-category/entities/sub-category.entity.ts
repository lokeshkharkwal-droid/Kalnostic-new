import { SubCategory, SubCategoryPersonMapping } from '@prisma/client';

/** Domain/response shape for a sub-category (the Prisma model is the DB source of truth). */
export type SubCategoryEntity = SubCategory;

/** A sub-category with its active person mappings eagerly loaded. */
export type SubCategoryWithMappings = SubCategory & {
  personMappings: SubCategoryPersonMapping[];
};
