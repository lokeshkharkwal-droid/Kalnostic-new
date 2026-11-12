import { Prisma, SampleStatus } from '@prisma/client';
import { collectionProgressByOrder } from '../../../common/utils/collection-progress.util';
import { deriveTatStatus } from '../constants/tat.constant';
import type { TatThresholds } from '../constants/tat.constant';
import {
  collectionRank,
  inHouseOrderBy,
  isOrderLevelSort,
  orderIdsBySampleValue,
  sampleStatusRank,
  sendMoment,
} from './in-house-sort.util';
import type { InHouseSortKey, OrderSortSample } from './in-house-sort.util';
import type { SortDirection } from './transfer-sort.util';

/** The statuses whose "Send details" cell is filled (the sample is out of this branch). */
const OUT_STATUSES = new Set<SampleStatus>([
  SampleStatus.SENT_INTERNAL,
  SampleStatus.FORWARD_EXTERNAL,
  SampleStatus.OUTSOURCED,
]);

export interface InHouseSortPageInput {
  tenantId: string;
  /** The list's filters, already built (the same `where` the unsorted list uses). */
  where: Prisma.OrderSampleWhereInput;
  sortBy: InHouseSortKey;
  dir: SortDirection;
  page: number;
  limit: number;
  /** Needed for the TAT sort only. */
  tat: TatThresholds;
  nowMs: number;
}

/**
 * The page of order ids for a sorted In-House list, and the total number of orders.
 * The list pages by ORDER (never splitting one), so a column is turned into one rank per
 * order. Columns the order holds (order, patient, doctor, panel) are sorted by the database.
 * The others are worked out from the order's samples: read the ids and the one value each
 * sample contributes, rank the orders, cut the page, and only then load its rows (the
 * same ids-first way the Lab Test child-count sort and the transfer queues work).
 * @param tx a tenant-scoped transaction
 */
export async function sortedOrderPage(
  tx: Prisma.TransactionClient,
  input: InHouseSortPageInput,
): Promise<{ orderIds: string[]; total: number }> {
  const { where, sortBy, dir, page, limit } = input;
  const skip = (page - 1) * limit;

  if (isOrderLevelSort(sortBy)) {
    const orderWhere: Prisma.OrderWhereInput = {
      orderSamples: { some: where },
    };
    const [rows, total] = await Promise.all([
      tx.order.findMany({
        where: orderWhere,
        orderBy: inHouseOrderBy(sortBy, dir),
        skip,
        take: limit,
        select: { id: true },
      }),
      tx.order.count({ where: orderWhere }),
    ]);
    return { orderIds: rows.map((r) => r.id), total };
  }

  const samples = await sampleValues(tx, input);
  const ranked = orderIdsBySampleValue(samples, dir);
  return { orderIds: ranked.slice(skip, skip + limit), total: ranked.length };
}

/** One entry per sample of the matching orders, carrying the value the chosen column shows for it. */
async function sampleValues(
  tx: Prisma.TransactionClient,
  input: InHouseSortPageInput,
): Promise<OrderSortSample[]> {
  const { where, sortBy, tenantId } = input;
  const rows = await tx.orderSample.findMany({
    where,
    select: {
      id: true,
      orderId: true,
      createdAt: true,
      status: true,
      barcode: true,
      departmentId: true,
      tests:
        sortBy === 'testName'
          ? { where: { deletedAt: null }, select: { testName: true } }
          : false,
    },
  });
  const entry = (
    r: (typeof rows)[number],
    value: number | string | null,
  ): OrderSortSample => ({ orderId: r.orderId, createdAt: r.createdAt, value });

  switch (sortBy) {
    case 'barcode':
      return rows.map((r) => entry(r, r.barcode?.trim() || null));
    case 'referredBy':
    case 'referralPanel': {
      const orders = await tx.order.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.orderId))] } },
        select: {
          id: true,
          referredByDoctor: { select: { firstName: true, lastName: true } },
          referralPanel: { select: { name: true } },
        },
      });
      const label = new Map<string, string | null>(
        orders.map((o) => {
          const d = o.referredByDoctor;
          const text =
            sortBy === 'referredBy'
              ? d
                ? `${d.firstName} ${d.lastName ?? ''}`
                : ''
              : (o.referralPanel?.name ?? '');
          return [o.id, text.trim() || null];
        }),
      );
      return rows.map((r) => entry(r, label.get(r.orderId) ?? null));
    }
    case 'sampleStatus':
      return rows.map((r) => entry(r, sampleStatusRank(r.status)));
    case 'tat':
      // the column shows a band only for a sample still being worked on; the older it is, the later it is
      return rows.map((r) =>
        entry(
          r,
          deriveTatStatus(r.createdAt, r.status, input.tat, input.nowMs)
            ? r.createdAt.getTime()
            : null,
        ),
      );
    case 'testName':
      return rows.map((r) => {
        const names = (r.tests ?? [])
          .map((t) => t.testName?.trim())
          .filter((n): n is string => !!n)
          .sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' }),
          );
        return entry(r, names[0] ?? null);
      });
    case 'department': {
      const ids = [
        ...new Set(
          rows.map((r) => r.departmentId).filter((v): v is string => !!v),
        ),
      ];
      const depts =
        ids.length > 0
          ? await tx.department.findMany({
              where: { id: { in: ids }, tenantId },
              select: { id: true, name: true },
            })
          : [];
      const name = new Map(depts.map((d) => [d.id, d.name]));
      return rows.map((r) =>
        entry(r, r.departmentId ? (name.get(r.departmentId) ?? null) : null),
      );
    }
    case 'collectionStatus': {
      const progress = await collectionProgressByOrder(tx, tenantId, [
        ...new Set(rows.map((r) => r.orderId)),
      ]);
      return rows.map((r) => {
        const p = progress.get(r.orderId);
        return entry(r, p ? collectionRank(p) : null);
      });
    }
    case 'sendDetails': {
      // the cell describes the sample's latest transfer, and only while the sample is out
      const outIds = rows
        .filter((r) => OUT_STATUSES.has(r.status))
        .map((r) => r.id);
      const transfers =
        outIds.length > 0
          ? await tx.sampleTransfer.findMany({
              where: { sampleId: { in: outIds }, deletedAt: null },
              orderBy: { createdAt: 'desc' },
              select: { sampleId: true, sendDate: true, sendTime: true },
            })
          : [];
      const latest = new Map<string, number | null>();
      for (const t of transfers) {
        if (!latest.has(t.sampleId)) {
          latest.set(t.sampleId, sendMoment(t.sendDate, t.sendTime));
        }
      }
      return rows.map((r) => entry(r, latest.get(r.id) ?? null));
    }
    default:
      // order-level keys never reach here (handled by the database)
      return rows.map((r) => entry(r, null));
  }
}
