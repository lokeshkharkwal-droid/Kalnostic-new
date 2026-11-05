import { Prisma, SampleStatus } from '@prisma/client';

/**
 * Order-level sample-collection progress, derived (never stored) from the order's
 * **samples** (`OrderSample.collectedAt`):
 * - `PENDING` — no counted sample collected yet,
 * - `PARTIAL` — some (but not all) counted samples collected,
 * - `COLLECTED` — every counted sample collected.
 *
 * "Collection Status" on the Accession in-house list and "Sample Status" on the
 * Registration Order Console are the same concept — both resolve to these three
 * values. Keep this helper as the single source of that rule so the displayed
 * value and the list filter can never drift.
 *
 * Why samples and not `OrderItem.collectedAt`: the item flag is only stamped by
 * the Order Overview's own Collect button, so a sample collected from the
 * Accession screen (or auto-collected at order creation) left the order reading
 * "Pending" forever. `OrderSample.collectedAt` is set by every collect path, so
 * reading it needs no write-side change and no backfill.
 */
export type CollectionProgress = 'PENDING' | 'PARTIAL' | 'COLLECTED';

/**
 * Bill-only tests/panels never enter the sample workflow (they are never
 * collected), so they must be excluded from every collection-progress check —
 * otherwise a fully-collected order carrying a bill-only item would read as
 * `PARTIAL` and never reach `COLLECTED`. Mirrors the item/collected counts the
 * order list exposes.
 */
export const COLLECTION_WORKFLOW_ITEM_WHERE: Prisma.OrderItemWhereInput = {
  NOT: {
    OR: [
      { branchLabTest: { isBillOnlyTest: true } },
      { branchLabPanel: { isBillOnlyTest: true } },
    ],
  },
};

/**
 * The samples that count toward an order's collection progress. A sample is left
 * out when it is:
 * - soft-deleted,
 * - `CANCELLED` (it will never be collected), or
 * - frozen because its test was removed from the order — it still has live test
 *   links and EVERY one belongs to a removed (soft-deleted) order item. A tube
 *   shared with a surviving test is kept: that test still needs it. This is the
 *   same "item-removed" rule as `isAllItemsRemoved` in the accession utils,
 *   expressed as a Prisma filter so it also works inside `where` clauses.
 */
export const COUNTED_SAMPLE_WHERE: Prisma.OrderSampleWhereInput = {
  deletedAt: null,
  status: { not: SampleStatus.CANCELLED },
  OR: [
    { tests: { none: { deletedAt: null } } },
    { tests: { some: { deletedAt: null, orderItem: { deletedAt: null } } } },
  ],
};

/** A counted sample that has been collected (`collectedAt` stamped). */
const COLLECTED_SAMPLE_WHERE: Prisma.OrderSampleWhereInput = {
  AND: [COUNTED_SAMPLE_WHERE, { collectedAt: { not: null } }],
};

/** A counted sample that has not been collected yet. */
const UNCOLLECTED_SAMPLE_WHERE: Prisma.OrderSampleWhereInput = {
  AND: [COUNTED_SAMPLE_WHERE, { collectedAt: null }],
};

/**
 * Build the Prisma `where` fragment that selects orders in a given collection
 * progress state, expressed over the order's counted samples
 * ({@link COUNTED_SAMPLE_WHERE}). Returned as a single `{ AND: [...] }`
 * `OrderWhereInput` so it composes cleanly:
 * - the order list pushes it onto its order-level `AND` array, and
 * - the accession list nests it under the sample's to-one `order` relation.
 * @param status the target collection progress
 * @returns an `OrderWhereInput` matching only orders in that state
 */
export function buildCollectionProgressWhere(
  status: CollectionProgress,
): Prisma.OrderWhereInput {
  switch (status) {
    case 'PENDING':
      // Has workflow items and no counted sample is collected yet.
      return {
        AND: [
          {
            items: {
              some: { deletedAt: null, ...COLLECTION_WORKFLOW_ITEM_WHERE },
            },
          },
          { orderSamples: { none: COLLECTED_SAMPLE_WHERE } },
        ],
      };
    case 'COLLECTED':
      // Has at least one counted sample, and none is still uncollected.
      return {
        AND: [
          { orderSamples: { some: COUNTED_SAMPLE_WHERE } },
          { orderSamples: { none: UNCOLLECTED_SAMPLE_WHERE } },
        ],
      };
    case 'PARTIAL':
      // At least one counted sample collected and at least one still uncollected.
      return {
        AND: [
          { orderSamples: { some: COLLECTED_SAMPLE_WHERE } },
          { orderSamples: { some: UNCOLLECTED_SAMPLE_WHERE } },
        ],
      };
  }
}

/**
 * Collection progress of each given order, derived from its counted samples
 * ({@link COUNTED_SAMPLE_WHERE}) — the display-side twin of
 * {@link buildCollectionProgressWhere}. Two grouped counts for the whole page, so
 * a list pays two small queries rather than one per row. An order with no counted
 * sample (not generated yet, or all cancelled) reads `PENDING`.
 * @param db Prisma client or transaction client
 * @param tenantId tenant scope
 * @param orderIds the page's order ids (may be empty)
 * @returns a map orderId → progress; every requested id is present
 */
export async function collectionProgressByOrder(
  db: Pick<Prisma.TransactionClient, 'orderSample'>,
  tenantId: string,
  orderIds: string[],
): Promise<Map<string, CollectionProgress>> {
  const result = new Map<string, CollectionProgress>();
  if (orderIds.length === 0) return result;
  const [totals, collected] = await Promise.all([
    db.orderSample.groupBy({
      by: ['orderId'],
      where: {
        AND: [COUNTED_SAMPLE_WHERE, { tenantId, orderId: { in: orderIds } }],
      },
      _count: { _all: true },
    }),
    db.orderSample.groupBy({
      by: ['orderId'],
      where: {
        AND: [COLLECTED_SAMPLE_WHERE, { tenantId, orderId: { in: orderIds } }],
      },
      _count: { _all: true },
    }),
  ]);
  const totalBy = new Map(totals.map((r) => [r.orderId, r._count._all]));
  const collectedBy = new Map(collected.map((r) => [r.orderId, r._count._all]));
  for (const id of orderIds) {
    result.set(
      id,
      deriveCollectionProgress(collectedBy.get(id) ?? 0, totalBy.get(id) ?? 0),
    );
  }
  return result;
}

/**
 * Derive the collection progress from collected / total counts. An order with
 * nothing to collect (no counted samples) reads as `PENDING`.
 * @param collectedWorkflowCount number already collected
 * @param totalWorkflowCount total number that count toward collection
 * @returns the derived collection progress
 */
export function deriveCollectionProgress(
  collectedWorkflowCount: number,
  totalWorkflowCount: number,
): CollectionProgress {
  if (totalWorkflowCount === 0 || collectedWorkflowCount === 0)
    return 'PENDING';
  if (collectedWorkflowCount >= totalWorkflowCount) return 'COLLECTED';
  return 'PARTIAL';
}
