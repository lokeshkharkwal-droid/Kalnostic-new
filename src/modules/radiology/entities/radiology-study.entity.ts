import { Prisma } from '@prisma/client';

/** A radiology study row (all scalar fields). */
export type RadiologyStudyRow = Prisma.RadiologyStudyGetPayload<{
  include: { statusHistory: false };
}>;

/** A radiology study with its append-only status history. */
export type RadiologyStudyWithHistory = Prisma.RadiologyStudyGetPayload<{
  include: { statusHistory: true };
}>;

/** Per-status counts for the worklist summary cards. */
export type RadiologyStudySummary = Partial<Record<string, number>> & {
  total: number;
};

/** Result of a bulk status action. */
export interface BulkRadiologyResult {
  succeeded: string[];
  failed: { id: string; reason: string }[];
}
