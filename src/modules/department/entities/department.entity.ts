import { Department, DepartmentPersonMapping } from '@prisma/client';

/** Domain/response shape for a department (the Prisma model is the DB source of truth). */
export type DepartmentEntity = Department;

/** A department with its active person mappings eagerly loaded. */
export type DepartmentWithMappings = Department & {
  personMappings: DepartmentPersonMapping[];
};
