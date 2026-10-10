/** One report that matched the worklist filters, with what the ordering needs. */
export interface WorklistMatch {
  /** `LabReport.id`. */
  id: string;
  /** `LabReport.createdAt` — stamped when the sample was accepted. */
  createdAt: Date;
  /** The report's order (`LabReport.orderItem.orderId`). */
  orderId: string;
  /** `Order.createdAt` — only the fallback when the order has no live sample. */
  orderCreatedAt: Date;
}

/**
 * Order the Technician Reporting Worklist the way the Accession worklist orders
 * its orders: newest first by when the order's **newest live sample** was created
 * (i.e. when the order actually entered accession), not by when the order row
 * itself was created. A Draft or Appointment that is converted into an order days
 * later keeps its old `Order.createdAt`, but its samples are generated at the
 * conversion — so the sample time is the one that reflects when the work arrived.
 *
 * Tie-breaks keep the result stable across pages and keep one order's reports
 * together: order creation time (newest first), then order id, then the report's
 * own creation time (oldest first), then report id. An order with no live sample
 * falls back to its own creation time.
 *
 * @param matches every report that passed the filters
 * @param latestSampleByOrder `orderId → max(OrderSample.createdAt)` over live samples
 * @returns a new array; the input is not modified
 */
export function sortWorklistMatches(
  matches: readonly WorklistMatch[],
  latestSampleByOrder: ReadonlyMap<string, Date>,
): WorklistMatch[] {
  const key = (m: WorklistMatch): number =>
    (latestSampleByOrder.get(m.orderId) ?? m.orderCreatedAt).getTime();
  return [...matches].sort(
    (a, b) =>
      key(b) - key(a) ||
      b.orderCreatedAt.getTime() - a.orderCreatedAt.getTime() ||
      (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
