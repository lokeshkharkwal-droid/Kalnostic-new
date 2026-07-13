import { Radiologist } from '@prisma/client';

/** Domain/response shape for a radiologist (the Prisma model is the source of truth). */
export type RadiologistEntity = Radiologist;

/** A resolved department reference embedded in radiologist reads. */
export interface DepartmentRef {
  id: string;
  name: string;
}

/**
 * A radiologist enriched with its resolved `department` object (`null` when
 * absent). The read shape returned by every radiologist endpoint.
 */
export type RadiologistWithRefs = Radiologist & {
  department: DepartmentRef | null;
};
