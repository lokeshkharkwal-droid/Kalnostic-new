import { Prisma } from '@prisma/client';

/**
 * Order-level sample-collection progress, derived (never stored) from the
 * `collectedAt` timestamps of an order's **workflow** items:
 * - `PENDING` — no workflow item collected yet,
 * - `PARTIAL` — some (but not all) workflow items collected,
 * - `COLLECTED` — every workflow item collected.
 *
 * "Collection Status" on the Accession in-house list and "Sample Status" on the
 * Registration Order Console are the same concept — both resolve to these three
 * values. Keep this helper as the single source of that rule so the displayed
 * value and the list filter can never drift.
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
 * Build the Prisma `where` fragment that selects orders in a given collection
 * progress state, expressed over the order's `items` and their `collectedAt`
 * (excluding bill-only items). Returned as a single `{ AND: [...] }`
 * `OrderWhereInput` so it composes cleanly:
 * - the order list pushes it onto its order-level `AND` array, and
 * - the accession list nests it under the sample's to-one `order` relation.
 * @param status the target collection progress
 * @returns an `OrderWhereInput` matching only orders in that state
 */
export function buildCollectionProgressWhere(
  status: CollectionProgress,
): Prisma.OrderWhereInput {
  const workflowItem = COLLECTION_WORKFLOW_ITEM_WHERE;
  switch (status) {
    case 'PENDING':
      // Has workflow items, none collected.
      return {
        AND: [
          { items: { some: { deletedAt: null, ...workflowItem } } },
          {
            items: {
              none: {
                deletedAt: null,
                collectedAt: { not: null },
                ...workflowItem,
              },
            },
          },
        ],
      };
    case 'COLLECTED':
      // Has workflow items, none still uncollected.
      return {
        AND: [
          { items: { some: { deletedAt: null, ...workflowItem } } },
          {
            items: {
              none: { deletedAt: null, collectedAt: null, ...workflowItem },
            },
          },
        ],
      };
    case 'PARTIAL':
      // At least one workflow item collected and at least one still uncollected.
      return {
        AND: [
          {
            items: {
              some: {
                deletedAt: null,
                collectedAt: { not: null },
                ...workflowItem,
              },
            },
          },
          {
            items: {
              some: { deletedAt: null, collectedAt: null, ...workflowItem },
            },
          },
        ],
      };
  }
}

/**
 * Derive the collection progress from an order's workflow-item counts — the
 * display-side twin of {@link buildCollectionProgressWhere} (and of the
 * frontend `deriveSampleStatus`). An order with no workflow items (e.g. all
 * bill-only) reads as `PENDING`.
 * @param collectedWorkflowCount number of workflow items already collected
 * @param totalWorkflowCount total number of workflow items
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
