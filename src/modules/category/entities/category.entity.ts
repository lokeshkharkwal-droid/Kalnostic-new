import { Category, CategoryPersonMapping } from '@prisma/client';

/** Domain/response shape for a category (the Prisma model is the DB source of truth). */
export type CategoryEntity = Category;

/** A category with its active person mappings eagerly loaded. */
export type CategoryWithMappings = Category & {
  personMappings: CategoryPersonMapping[];
};
