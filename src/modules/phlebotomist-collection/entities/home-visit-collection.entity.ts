import { CollectionStatus, Prisma } from '@prisma/client';

/**
 * `include` for a home-visit collection list row. Pulls the linked order's patient,
 * referral refs, payment ledger (amount fields only, for the financial rollups),
 * the diagnostics section (charges + address + times), the generated accession
 * samples (for the barcode + sample-status display), the active items (to derive a
 * collected count), the linked appointment status, and the assigned phlebotomist —
 * so every Collection Schedule / report column renders without a second fetch.
 */
export const COLLECTION_LIST_INCLUDE = {
  phlebotomist: {
    select: { id: true, firstName: true, lastName: true, designation: true },
  },
  order: {
    select: {
      id: true,
      orderCode: true,
      billId: true,
      orderDate: true,
      orderTime: true,
      status: true,
      isUrgentBill: true,
      paymentStatus: true,
      branch: { select: { id: true, name: true } },
      patient: {
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          mobile: true,
          alternateMobileNumber: true,
          email: true,
          gender: true,
          age: true,
          dateOfBirth: true,
          umId: true,
          addressLine1: true,
          addressLine2: true,
          area: true,
          city: true,
          state: true,
          pincode: true,
        },
      },
      referredByDoctor: {
        select: { id: true, firstName: true, lastName: true },
      },
      referralPanel: { select: { id: true, name: true, code: true } },
      appointment: { select: { id: true, status: true } },
      diagnostics: {
        select: {
          isHomeVisit: true,
          sampleSource: true,
          collectionAddress: true,
          collectionAt: true,
          appointmentAt: true,
          geoLocation: true,
          visitCharges: true,
          sampleCollectionCharges: true,
        },
      },
      payments: {
        where: { deletedAt: null },
        select: {
          totalAmount: true,
          orderDiscount: true,
          visitingCharges: true,
          netAmount: true,
          paidAmount: true,
        },
      },
      accessionSamples: {
        where: { deletedAt: null },
        select: { id: true, accessionNo: true, barcode: true, status: true },
      },
      items: {
        where: { deletedAt: null },
        select: { id: true, collectedAt: true },
      },
    },
  },
} satisfies Prisma.HomeVisitCollectionInclude;

/** `include` for a single collection (Collection Overview + audit trail). */
export const COLLECTION_DETAIL_INCLUDE = {
  ...COLLECTION_LIST_INCLUDE,
  statusHistory: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.HomeVisitCollectionInclude;

/** A raw collection row with the list include applied (pre-derivation). */
export type CollectionWithRelations = Prisma.HomeVisitCollectionGetPayload<{
  include: typeof COLLECTION_LIST_INCLUDE;
}>;

/** A single collection with its status history (detail view). */
export type CollectionWithHistory = Prisma.HomeVisitCollectionGetPayload<{
  include: typeof COLLECTION_DETAIL_INCLUDE;
}>;

/** One raw status-history row (as included by the detail read). */
export type CollectionStatusHistoryRow =
  CollectionWithHistory['statusHistory'][number];

/**
 * A status-history row enriched with the resolved actor name. `changedBy` is a
 * platform-level `Person` id (a UID); `changedByName` is that person's display
 * name so the Collection Overview audit trail shows a name, not a UID.
 */
export type CollectionHistoryRow = CollectionStatusHistoryRow & {
  changedByName: string | null;
};

/** The detail read's return shape: the collection + enriched status history. */
export type CollectionDetail = Omit<CollectionWithHistory, 'statusHistory'> &
  CollectionListRow & { statusHistory: CollectionHistoryRow[] };

/**
 * A Collection Schedule row: the raw collection + relations plus the derived
 * financial rollups (all minor units), a barcode (first generated sample), and the
 * item collection counts. This is the flattened shape both the schedule table and
 * the patient-wise report consume.
 */
export interface CollectionListRow extends CollectionWithRelations {
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  paidAmount: number;
  balanceAmount: number;
  visitCharges: number;
  sampleCollectionCharges: number;
  barcode: string | null;
  itemCount: number;
  collectedItemCount: number;
}

/**
 * Derive the financial rollups + display extras for one collection row from its
 * included order relation. Kept as a pure helper so the list and the detail read
 * agree on the numbers.
 * @param row a collection with the list include applied
 * @returns the row enriched with derived financials / barcode / item counts
 */
export function toCollectionListRow(
  row: CollectionWithRelations,
): CollectionListRow {
  const payments = row.order?.payments ?? [];
  const grossAmount = payments.reduce((s, p) => s + p.totalAmount, 0);
  const discountAmount = payments.reduce((s, p) => s + p.orderDiscount, 0);
  const netAmount = payments.reduce((s, p) => s + p.netAmount, 0);
  const paidAmount = payments.reduce((s, p) => s + p.paidAmount, 0);
  const diagnostics = row.order?.diagnostics ?? null;
  const items = row.order?.items ?? [];
  const samples = row.order?.accessionSamples ?? [];
  const withBarcode = samples.find((s) => s.barcode);
  return {
    ...row,
    grossAmount,
    discountAmount,
    netAmount,
    paidAmount,
    balanceAmount: Math.max(netAmount - paidAmount, 0),
    visitCharges: diagnostics?.visitCharges ?? 0,
    sampleCollectionCharges: diagnostics?.sampleCollectionCharges ?? 0,
    barcode: withBarcode?.barcode ?? null,
    itemCount: items.length,
    collectedItemCount: items.filter((i) => i.collectedAt != null).length,
  };
}

/** Dashboard summary payload (all counts default to 0 when there is no data). */
export interface CollectionSummary {
  total: number;
  /** Count per collection status (every status present, 0 default). */
  byStatus: Record<CollectionStatus, number>;
  completed: number;
  pending: number;
  cancelled: number;
  /** Per-phlebotomist rollup (assigned / completed / pending / cancelled). */
  byPhlebotomist: PhlebotomistSummaryRow[];
  /** Per-day scheduled-collection trend (ascending by date). */
  byDate: { date: string; count: number }[];
  totalVisitCharges: number;
  totalSampleCollectionCharges: number;
}

/** One phlebotomist's rollup — shared by the dashboard summary + phleb-wise report. */
export interface PhlebotomistSummaryRow {
  phlebotomistId: string | null;
  phlebotomistName: string;
  assigned: number;
  completed: number;
  pending: number;
  cancelled: number;
  /** Total visit + sample-collection charges across the phlebotomist's collections. */
  totalCharges: number;
  /** Total distance travelled (km). No backend source yet (Route Mapping — deferred). */
  totalKm: number | null;
  /** On-time completion %. No backend source yet (Route Mapping — deferred). */
  onTimePercentage: number | null;
}
