/**
 * The reasons the SYSTEM writes when it closes a transfer as REJECTED on its own —
 * no receiving branch decided anything. Kept in one place so the writers and the
 * Accession dashboard's "Rejected Samples" count (which must leave these out: it
 * counts the receiving branch's own rejections) can never drift apart.
 */

/** The sender pulled the sample back (Retrieve) before the receiving branch received it. */
export const RECALLED_VIA_RETRIEVE_REASON = 'Recalled via Retrieve';

/** The test was removed from the order while its sample was still on its way. */
export const ORDER_ITEM_REMOVED_REASON = 'Order item removed';

/** Every system-written close reason (never a receiving branch's rejection decision). */
export const SYSTEM_TRANSFER_CLOSE_REASONS: readonly string[] = [
  RECALLED_VIA_RETRIEVE_REASON,
  ORDER_ITEM_REMOVED_REASON,
];
