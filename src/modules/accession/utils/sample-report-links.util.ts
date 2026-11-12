import { Prisma, TransferKind } from '@prisma/client';
import type { SampleTestLink } from './order-overview.util';

/** What {@link loadSampleReportLinks} returns. */
export interface SampleReportLinks {
  /**
   * Per sample: the (order line, test) links of the sample AND of every copy of it down the chain.
   * A report follows the test to the branch that accepted the sample and is then re-pointed at THAT
   * branch's own copy of the test, so the sender's sample alone no longer matches its panel-member
   * report; the copy does. Matching with all of them finds the report wherever it is held.
   */
  linksBySample: Map<string, SampleTestLink[]>;
  /** sample id -> the id of the copy its newest accepted INTERNAL transfer produced. */
  cloneOf: Map<string, string>;
}

/** How many copies down the chain are followed (sent on again and again): more than any real chain. */
const MAX_HOPS = 6;

/**
 * Load, for each sample, the links it needs to find its report - own and its copies' (see
 * {@link SampleReportLinks.linksBySample}) - and the chain of copies itself (for "where is it now").
 * Read-only; a handful of small queries however many samples there are.
 * @param tx a tenant-scoped transaction client
 */
export async function loadSampleReportLinks(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sampleIds: readonly string[],
): Promise<SampleReportLinks> {
  const cloneOf = new Map<string, string>();
  let frontier = [...sampleIds];
  for (let hop = 0; hop < MAX_HOPS && frontier.length > 0; hop++) {
    const transfers = await tx.sampleTransfer.findMany({
      where: {
        tenantId,
        sampleId: { in: frontier },
        kind: TransferKind.INTERNAL,
        deletedAt: null,
        clonedSampleId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { sampleId: true, clonedSampleId: true },
    });
    const next: string[] = [];
    for (const t of transfers) {
      // newest transfer first: the first one seen per sample is the live one
      if (cloneOf.has(t.sampleId) || !t.clonedSampleId) continue;
      cloneOf.set(t.sampleId, t.clonedSampleId);
      next.push(t.clonedSampleId);
    }
    frontier = next;
  }

  const allIds = [...new Set([...sampleIds, ...cloneOf.values()])];
  const rows =
    allIds.length > 0
      ? await tx.orderSampleTest.findMany({
          where: { tenantId, sampleId: { in: allIds }, deletedAt: null },
          select: { sampleId: true, orderItemId: true, labTestId: true },
        })
      : [];
  const own = new Map<string, SampleTestLink[]>();
  for (const r of rows) {
    const list = own.get(r.sampleId) ?? [];
    list.push({ orderItemId: r.orderItemId, labTestId: r.labTestId });
    own.set(r.sampleId, list);
  }

  const linksBySample = new Map<string, SampleTestLink[]>();
  for (const id of sampleIds) {
    const chain = [id];
    const seen = new Set(chain);
    for (
      let cur = cloneOf.get(id);
      cur && !seen.has(cur);
      cur = cloneOf.get(cur)
    ) {
      seen.add(cur);
      chain.push(cur);
    }
    linksBySample.set(
      id,
      chain.flatMap((c) => own.get(c) ?? []),
    );
  }
  return { linksBySample, cloneOf };
}
