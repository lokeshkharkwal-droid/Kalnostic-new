import { AccessionGroupingMode, Prisma, SampleStatus } from '@prisma/client';
import { TatStatus } from '../constants/tat.constant';
import type { CollectionProgress } from '../../../common/utils/collection-progress.util';

/**
 * Lightweight relations included on every accession sample list row — mirrors the
 * `ORDER_LIST_INCLUDE` idiom. The order carries the patient + referral context the
 * list table columns need (PDF §A.6); `tests` carries the per-sample test names.
 */
export const SAMPLE_LIST_INCLUDE = {
  tests: { where: { deletedAt: null } },
  // Latest transfer only: lets the in-house list tell whether a sent sample can still
  // be retrieved / re-addressed (only until the receiving branch has received it),
  // whether it already has a center ("Edit Center" vs "Assign Center"), and why the
  // receiving branch sent it back ("Sent - Repeated / Rejected" tooltip) without
  // fetching the full detail per row.
  transfers: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      kind: true,
      transferStatus: true,
      destinationBranchId: true,
      outsourceCenterId: true,
      // Where / when / how it went, for the list's "Send details" column (the same facts the
      // Internal Referral / Outsource pages show for the other side).
      externalPartnerName: true,
      sendDate: true,
      sendTime: true,
      sampleForm: true,
      logisticsType: true,
      logisticsPerson: true,
      createdAt: true,
      rejectionReason: true,
      repeatReason: true,
    },
  },
  order: {
    select: {
      id: true,
      orderCode: true,
      orderDate: true,
      orderTime: true,
      createdAt: true,
      // CANCELLED here freezes the sample: the list shows an "Order cancelled" tag.
      status: true,
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
    where: { deletedAt: null },
    include: {
      orderItem: {
        select: {
          // Set when the test was removed from the order (see `itemRemoved`).
          deletedAt: true,
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
  // Exclude soft-deleted transfers so a recalled (Retrieve) transfer never lingers
  // on the sample's own transfer list / Edit-Center lookup (findTransfers already
  // filters deletedAt: null on the receiving queue).
  transfers: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
  order: {
    select: {
      id: true,
      orderCode: true,
      orderDate: true,
      orderTime: true,
      createdAt: true,
      // CANCELLED here freezes the sample: the list shows an "Order cancelled" tag.
      status: true,
      billId: true,
      patient: true,
      referredByDoctor: true,
      referralPanel: true,
    },
  },
} satisfies Prisma.OrderSampleInclude;

/** What Prisma returns for one list row (the latest transfer carries ids only). */
type OrderSampleListRowRaw = Prisma.OrderSampleGetPayload<{
  include: typeof SAMPLE_LIST_INCLUDE;
}>;

/**
 * The latest transfer of a list row, plus the names the "Send details" column shows (the
 * destination branch / outsource center are logical refs, so the names are resolved in one
 * batched lookup per page - see `OrderSampleService.withTransferNames`; absent = not resolved).
 */
export type ListRowTransfer = OrderSampleListRowRaw['transfers'][number] & {
  destinationBranchName?: string | null;
  outsourceCenterName?: string | null;
};

/** An accession sample list row with its test links + order/patient context. */
export type OrderSampleListRow = Omit<OrderSampleListRowRaw, 'transfers'> & {
  transfers: ListRowTransfer[];
  /**
   * The Discard Method picked when the sample was discarded (the Discarded tab's column).
   * Not a column on the sample: read from its latest `discard` history entry, only for a
   * sample that is Discarded right now; absent / null otherwise.
   */
  discardMethod?: string | null;
};

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
export type OrderSampleDetail = Omit<
  OrderSampleWithRelations,
  'tests' | 'transfers'
> & {
  departmentLabel: string | null;
  /**
   * True when the test(s) this sample carries were removed from the order: the
   * sample is kept but frozen (only Store / Discard stay open), tagged "Test
   * removed from order". Derived from the order items' `deletedAt`, not stored.
   */
  itemRemoved: boolean;
  tests: (OrderSampleWithRelations['tests'][number] & {
    department: string | null;
  })[];
  /**
   * Transfers enriched with the resolved OUTSOURCE center name (`outsourceCenterId`
   * is a logical ref — see `withDepartments`). Lets the Assign/Edit Center flow
   * pre-fill the current center instead of opening blank.
   */
  transfers: (OrderSampleWithRelations['transfers'][number] & {
    outsourceCenterName: string | null;
  })[];
};

/** A list row enriched with its derived TAT band (§A.4 — not stored). */
export type OrderSampleListItem = OrderSampleListRow & {
  tatStatus: TatStatus | null;
  /** True when the test(s) on this sample were removed from the order (frozen, kept for wind-down). */
  itemRemoved: boolean;
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
  /**
   * Order-level sample **collection progress** (`PENDING`/`PARTIAL`/`COLLECTED`),
   * derived from the order's workflow items' `collectedAt` — the §A.6 "Collection
   * Status" column. Set by the paged in-house list (`findAllGrouped`); omitted by
   * the single-order grouped view (Product Overview), which doesn't show it.
   */
  collectionStatus?: CollectionProgress;
}
