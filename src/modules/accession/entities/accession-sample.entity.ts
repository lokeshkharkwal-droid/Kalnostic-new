import { AccessionGroupingMode, Prisma, SampleStatus } from '@prisma/client';
import { TatStatus } from '../constants/tat.constant';

/**
 * Lightweight relations included on every accession sample list row — mirrors the
 * `ORDER_LIST_INCLUDE` idiom. The order carries the patient + referral context the
 * list table columns need (PDF §A.6); `tests` carries the per-sample test names.
 */
export const SAMPLE_LIST_INCLUDE = {
  tests: true,
  order: {
    select: {
      id: true,
      orderCode: true,
      orderDate: true,
      orderTime: true,
      billId: true,
      patient: true,
      referredByDoctor: true,
      referralPanel: true,
    },
  },
} satisfies Prisma.OrderSampleInclude;

/**
 * Full relations for a single accession sample (Sample Overview — PDF §A.10.4).
 * `tests` additionally reaches its order item's `branchLabTest`/`branchLabPanel`
 * so `findById` can resolve each test's department (the classification lives as a
 * logical `departmentId` ref — no Prisma relation — so the name is resolved
 * separately and attached as `department` / sample-level `departmentLabel`).
 */
export const SAMPLE_INCLUDE = {
  tests: {
    include: {
      orderItem: {
        select: {
          branchLabTest: { select: { departmentId: true } },
          branchLabPanel: { select: { departmentId: true } },
          // The center this order line was assigned to at order create/edit
          // time (null = in-house) — surfaced so the Outsource Sample modal
          // can pre-select it instead of opening blank (PDF §A.10.16).
          outsourceCenterId: true,
          outsourceCenter: { select: { id: true, name: true } },
        },
      },
    },
  },
  statusHistory: { orderBy: { createdAt: 'desc' } },
  transfers: { orderBy: { createdAt: 'desc' } },
  order: {
    select: {
      id: true,
      orderCode: true,
      orderDate: true,
      orderTime: true,
      billId: true,
      patient: true,
      referredByDoctor: true,
      referralPanel: true,
    },
  },
} satisfies Prisma.OrderSampleInclude;

/** An accession sample list row with its test links + order/patient context. */
export type OrderSampleListRow = Prisma.OrderSampleGetPayload<{
  include: typeof SAMPLE_LIST_INCLUDE;
}>;

/** A fully-composed accession sample (tests + history + transfers + order). */
export type OrderSampleWithRelations = Prisma.OrderSampleGetPayload<{
  include: typeof SAMPLE_INCLUDE;
}>;

/**
 * A single accession sample enriched with resolved department names (Sample
 * Overview drawer). `departmentLabel` is the distinct set of the tests'
 * departments joined with ", " (null when none resolve); each test also carries
 * its own `department` name.
 */
export type OrderSampleDetail = Omit<OrderSampleWithRelations, 'tests'> & {
  departmentLabel: string | null;
  tests: (OrderSampleWithRelations['tests'][number] & {
    department: string | null;
  })[];
};

/** A list row enriched with its derived TAT band (§A.4 — not stored). */
export type OrderSampleListItem = OrderSampleListRow & {
  tatStatus: TatStatus | null;
};

/**
 * Accession list summary — powers the §A.5 status tabs (a count per status, all
 * statuses present with 0 default) and the §A.4 TAT bar (a count per TAT band),
 * plus the overall total.
 */
export interface AccessionSummary {
  total: number;
  byStatus: Record<SampleStatus, number>;
  byTat: Record<TatStatus, number>;
}

/** A list sample enriched with its resolved department name for grouped views. */
export type GroupedSampleItem = OrderSampleListItem & {
  departmentName: string | null;
};

/**
 * One **final group** within an order — the unit a status/barcode action targets.
 * Order ID is always the top-level grouping (Critical Rule #1: never group across
 * orders); within an order, samples are grouped by the tenant's **current
 * grouping mode** (Sample/Order/Department/Department+Sample), so display,
 * barcode and action scope stay in lock-step with the live Group Settings.
 * `barcode`/`department`/`sampleLabel` are the single distinct value across the
 * group (else `null` — e.g. `barcode` is `null` when members carry differing/
 * blank barcodes, flagging the group for a fresh Assign Barcode). `sampleIds` is
 * the flat set the group's action button targets, so a status change cascades to
 * every sample in the group (Rule #3).
 */
export interface InHouseSampleGroup {
  groupKey: string;
  barcode: string | null;
  department: { id: string | null; name: string } | null;
  sampleLabel: string | null;
  sampleIds: string[];
  samples: GroupedSampleItem[];
}

/**
 * One order of the grouped in-house list — the top-level grouping and the
 * group-aware pagination unit. `order` carries the header context (patient,
 * referral); `groups` are the final (barcode) groups within the order;
 * `groupingMode` echoes the tenant's current mode as a layout hint for the FE.
 */
export interface InHouseOrderGroup {
  orderId: string;
  order: OrderSampleListRow['order'] | null;
  groupingMode: AccessionGroupingMode;
  sampleIds: string[];
  groups: InHouseSampleGroup[];
}
