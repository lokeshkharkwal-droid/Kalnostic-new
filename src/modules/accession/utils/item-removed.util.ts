import { Prisma } from '@prisma/client';

/** The slice of a Prisma client (or transaction client) these helpers need. */
type ItemRemovedDb = Pick<Prisma.TransactionClient, 'orderSampleTest'>;

/**
 * "Test removed from order" rule. Removing a test from an order soft-deletes its
 * `OrderItem` (`order_items.deleted_at`). When the test already has a report, the
 * sample(s) and report(s) are KEPT but frozen, so "removed" is not stored anywhere
 * else - it is derived from that item's `deletedAt`.
 *
 * A sample is item-removed when it still has live test links and EVERY one of
 * them belongs to a removed order item. A tube shared with a surviving test is
 * not frozen: the surviving test still needs it.
 * @param links the sample's live (`deletedAt: null`) test links with their item's `deletedAt`
 */
export function isAllItemsRemoved(
  links: ReadonlyArray<{
    orderItem?: { deletedAt: Date | null } | null;
  }>,
): boolean {
  return (
    links.length > 0 &&
    links.every((l) => l.orderItem != null && l.orderItem.deletedAt != null)
  );
}

/**
 * Which of the given samples are item-removed (see {@link isAllItemsRemoved}).
 * One query for the whole set, so list responses pay a single extra round trip
 * rather than one per row.
 * @param db Prisma client or transaction client
 * @param tenantId tenant scope
 * @param sampleIds the samples to check (may be empty)
 */
export async function findItemRemovedSampleIds(
  db: ItemRemovedDb,
  tenantId: string,
  sampleIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(sampleIds)];
  if (unique.length === 0) return new Set();
  const links = await db.orderSampleTest.findMany({
    where: { tenantId, sampleId: { in: unique }, deletedAt: null },
    select: {
      sampleId: true,
      orderItem: { select: { deletedAt: true } },
    },
  });
  const bySample = new Map<string, Array<(typeof links)[number]>>();
  for (const l of links) {
    const list = bySample.get(l.sampleId) ?? [];
    list.push(l);
    bySample.set(l.sampleId, list);
  }
  const removed = new Set<string>();
  for (const [sampleId, list] of bySample) {
    if (isAllItemsRemoved(list)) removed.add(sampleId);
  }
  return removed;
}

/**
 * Whether one sample is item-removed (see {@link isAllItemsRemoved}) - the single
 * question every accession / transfer action asks, next to "is the order
 * cancelled?".
 * @param db Prisma client or transaction client
 * @param tenantId tenant scope
 * @param sampleId the sample to check
 */
export async function isSampleItemRemoved(
  db: ItemRemovedDb,
  tenantId: string,
  sampleId: string,
): Promise<boolean> {
  return (await findItemRemovedSampleIds(db, tenantId, [sampleId])).has(
    sampleId,
  );
}

/**
 * Prisma `where` fragment matching samples that are NOT item-removed - the
 * database-side twin of {@link isAllItemsRemoved}: it excludes a sample that has
 * at least one live test link and whose every link is a soft-deleted one or
 * belongs to a removed order item. Spread it into an `OrderSample` filter to keep
 * a frozen sample out of "live work" counts (it must not use `NOT` itself).
 */
export const SAMPLE_NOT_ITEM_REMOVED = {
  NOT: {
    tests: {
      some: { deletedAt: null },
      every: {
        OR: [
          { deletedAt: { not: null } },
          { orderItem: { deletedAt: { not: null } } },
        ],
      },
    },
  },
} satisfies Prisma.OrderSampleWhereInput;
