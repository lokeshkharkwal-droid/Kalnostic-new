import { CollectionStatus } from '@prisma/client';

/**
 * Collection-status groupings for the Collection Schedule chips, the dashboard
 * stat cards and the report rollups.
 *
 * Note: status changes are **unrestricted** (any status → any status) — there is
 * no server-side transition state machine. These sets only classify statuses for
 * display/aggregation, they do not gate transitions.
 */

/**
 * The "In Progress" chip on the Collection Schedule — a collection somewhere in
 * the active field/lab pipeline (confirmed onward, before it completes or ends).
 * Used by the `statusGroup=IN_PROGRESS` list filter so the chip paginates
 * server-side like the single-status chips.
 */
export const IN_PROGRESS_COLLECTION_STATUSES: readonly CollectionStatus[] = [
  CollectionStatus.PATIENT_INFORMED,
  CollectionStatus.STARTED_FROM_CENTER,
  CollectionStatus.REACHED_PATIENT_LOCATION,
  CollectionStatus.SAMPLE_COLLECTED,
  CollectionStatus.COLLECTION_VERIFIED,
  CollectionStatus.IN_TRANSIT,
  CollectionStatus.RECEIVED_AT_LAB,
  CollectionStatus.ACCEPTED_BY_LAB,
];

/** Collection statuses that count as "completed" for dashboard/report rollups. */
export const COMPLETED_COLLECTION_STATUSES: readonly CollectionStatus[] = [
  CollectionStatus.COMPLETED,
];

/** Collection statuses that count as "cancelled/failed" for rollups. */
export const CANCELLED_COLLECTION_STATUSES: readonly CollectionStatus[] = [
  CollectionStatus.CANCELLED,
];

/**
 * "Pending" = still in the active field/lab pipeline (neither completed nor
 * cancelled). Used by the dashboard stat cards and phlebotomist-wise report.
 */
export const PENDING_COLLECTION_STATUSES: readonly CollectionStatus[] =
  Object.values(CollectionStatus).filter(
    (s) =>
      !COMPLETED_COLLECTION_STATUSES.includes(s) &&
      !CANCELLED_COLLECTION_STATUSES.includes(s),
  );
