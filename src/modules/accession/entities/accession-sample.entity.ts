import { Prisma, SampleStatus } from '@prisma/client';
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

/**
 * How the in-house list is grouped + the scope a group's action button applies
 * to, derived from the tenant's `AccessionGroupingMode` (Grouping Settings):
 * - `SAMPLE` (Sample-wise): order-grouped display, each sample acted on alone.
 * - `ORDER` (Order-wise): one action set per order.
 * - `DEPARTMENT` (Department-wise): one action set per department.
 * - `DEPARTMENT_SAMPLE` (Department + Sample-wise): one per department+sample.
 */
export type SampleActionScope =
  | 'SAMPLE'
  | 'ORDER'
  | 'DEPARTMENT'
  | 'DEPARTMENT_SAMPLE';

/** Top-level grouping unit (also the group-aware pagination unit). */
export type AccessionGroupType = 'ORDER' | 'DEPARTMENT';

/** A list sample enriched with its resolved department name for grouped views. */
export type GroupedSampleItem = OrderSampleListItem & {
  departmentName: string | null;
};

/** A secondary (sample-name) group inside a department — Department+Sample mode. */
export interface OrderSampleSubGroup {
  sampleKey: string;
  sampleLabel: string;
  sampleIds: string[];
  samples: GroupedSampleItem[];
}

/**
 * One top-level group of the grouped in-house list. `order` is set for ORDER
 * groups (header context), `department` for DEPARTMENT groups. `sampleIds` is the
 * flat set the group's action button targets ("send all + skip invalid").
 * `subGroups` is populated only in Department+Sample mode.
 */
export interface OrderSampleGroup {
  groupKey: string | null;
  groupType: AccessionGroupType;
  actionScope: SampleActionScope;
  order: OrderSampleListRow['order'] | null;
  department: { id: string | null; name: string } | null;
  sampleIds: string[];
  samples: GroupedSampleItem[];
  subGroups: OrderSampleSubGroup[] | null;
}
