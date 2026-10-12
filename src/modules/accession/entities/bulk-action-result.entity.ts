/**
 * Result shape for the bulk (multi-select) sample/transfer actions (PDF §A.11).
 *
 * Every `/accession/order-samples/bulk/*` endpoint resolves to this so the front
 * end can report successes and skips **separately** — the "In-House Orders"
 * multi-select bar needs to name exactly which samples it could not process and
 * why (e.g. a sample whose status changed underneath the user, or a `retrieve`
 * on a freshly-created sample with no prior status to revert to).
 *
 * - `succeeded` — the fully-composed rows that actually changed (same element
 *   type the single-item endpoint returns: a sample for status actions, a
 *   transfer for Send/Forward/Outsource).
 * - `skipped` — one entry per id that was **not** in a legal state for the
 *   action. Only populated when the request opts into `skipInvalid` (group /
 *   multi-select actions); strict bulk still fails the whole batch instead.
 */
export interface BulkSkippedItem {
  /** The order-sample id that was skipped. */
  id: string;
  /** The sample's accession number, for display (null if it could not be read). */
  accessionNo: string | null;
  /** Human-readable reason the id was skipped (mirrors the §A.9 transition rule). */
  reason: string;
}

export interface BulkActionResult<T> {
  succeeded: T[];
  skipped: BulkSkippedItem[];
}
