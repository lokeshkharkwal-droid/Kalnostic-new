import { LabReportStatus, OrderStatus, SampleStatus } from '@prisma/client';

/**
 * Predicate sets that define when an `Order` is "actively using" a referral —
 * the single source of truth for the referral delete guard (used by
 * `ReferralUsageService`). Deriving these from the Prisma enums keeps them from
 * drifting as the enums evolve.
 *
 * An order blocks deletion of a referral when it is NOT cancelled/soft-deleted
 * AND it is still mid-workflow: either a lab report is not yet published
 * (mid technician/reporting stage) OR a sample is still in an in-flight
 * accessioning state (below). Draft/quote orders (no samples) and completed
 * orders do NOT block — crucially, once every report is `PUBLISHED` the order is
 * done even though its samples rest at `ACCEPTED`/`ACQUIRED`/`STORED` (publishing
 * a report never moves the sample to a terminal status).
 *
 * Why an explicit "in-flight" set rather than "not terminal": a completed order's
 * samples sit at `ACCEPTED`/`ACQUIRED`/`STORED`, which are NOT terminal — so a
 * "not-terminal" test would keep every published order blocked. Those states are
 * instead governed by the report branch (reports are generated at `ACCEPTED`), so
 * the sample branch only needs the states where a sample is still being collected
 * / processed / transferred and has no governing published report yet.
 */

/**
 * Sample statuses that mean the order is still in an active accessioning workflow
 * (being collected, processed, or transferred) — the sample branch of the guard.
 * Excludes `ACCEPTED`/`ACQUIRED`/`STORED` (governed by the report branch) and the
 * terminal `CANCELLED`/`DISCARDED`/`RETURNED`/`ERROR`.
 */
export const ACTIVE_SAMPLE_STATUSES: readonly SampleStatus[] = [
  SampleStatus.NEW,
  SampleStatus.COLLECTED,
  SampleStatus.HOLD,
  SampleStatus.REPEAT,
  SampleStatus.HALT,
  SampleStatus.SENT_INTERNAL,
  SampleStatus.FORWARD_EXTERNAL,
  SampleStatus.OUTSOURCED,
];

/** The only terminal lab-report status; every other value is active work. */
export const TERMINAL_LAB_REPORT_STATUS: LabReportStatus =
  LabReportStatus.PUBLISHED;

/** Order statuses that are NOT actively using a referral. */
export const INACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.CANCELLED,
];
