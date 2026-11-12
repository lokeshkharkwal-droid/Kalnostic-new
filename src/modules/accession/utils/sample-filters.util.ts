import {
  Prisma,
  SamplePriority,
  SampleStatus,
  TransferKind,
} from '@prisma/client';
import { timestampRange } from '../../../common/utils/date-range.util';
import { buildCollectionProgressWhere } from '../../../common/utils/collection-progress.util';
import { TRANSFERRED_STATUSES } from '../constants/sample-transitions.constant';
import {
  TERMINAL_SAMPLE_STATUSES,
  TatThresholds,
  tatCreatedAtRange,
} from '../constants/tat.constant';
import type { ListSamplesDto, OrderMode } from '../dto/list-samples.dto';
import { escapeLike } from './like-escape.util';

/**
 * The user-chosen FILTER conditions of the accession sample list, kept apart from the
 * SCOPE (tenant, branch, department visibility) so the same filters can be reused for
 * other lists - e.g. the transfer queues, where a row's sample belongs to the SENDER's
 * branch and the viewer's branch condition would be wrong.
 *
 * - `sample`: conditions on the sample's own columns (status, priority, ids, TAT range).
 * - `order`: conditions on the sample's order (a to-one relation).
 * - `and`: composite conditions that must not clobber each other (search, urgent,
 *   outsource, transfer conditions...).
 */
export interface SampleFilterConditions {
  sample: Prisma.OrderSampleWhereInput;
  order: Prisma.OrderWhereInput;
  and: Prisma.OrderSampleWhereInput[];
}

/**
 * Filters that cannot be written as a plain relation condition and are resolved with
 * an extra query first (see `OrderSampleService.resolveAsyncFilters`):
 * - `labTestIds`: the tests of the chosen category / subcategory (a sample keeps only
 *   its test's id, not its classification);
 * - `reportStatusSampleIds`: the samples whose report has the chosen status (a panel
 *   member's sample must match ITS OWN report, which a relation filter cannot say);
 * - `orderStatusOrderIds`: the orders whose roll-up status (Order Status) matches.
 */
export interface ResolvedSampleFilters {
  labTestIds?: string[];
  reportStatusSampleIds?: string[];
  /** The orders whose overall (roll-up) report status is the chosen one. */
  orderStatusOrderIds?: string[];
}

/**
 * What a sample's transfer of one `kind` must satisfy, ALL ON THE SAME TRANSFER: where it went
 * (branch / partner / center) and the day it was dispatched. One transfer has to meet every
 * condition - a sample sent to B on the 28th and later to C on the 30th is found by
 * "B + 28th", never by "B + 30th". `sampleStatus` is set when the question is "where is it
 * NOW" (Sent / Forwarded): the sample must still be in that status, but the transfer that
 * matches may be an older one the other side closed as repeated / rejected.
 */
export interface TransferMatch {
  kind: TransferKind;
  sampleStatus?: SampleStatus;
  /** Every condition the transfer must meet (the live / kind conditions are added by {@link transferWhereOf}). */
  conditions: Prisma.SampleTransferWhereInput[];
}

/** "Dispatched on `day`" (YYYY-MM-DD, whole day): the transfer's `sendDate`, else when it was created. */
function dispatchedOn(day: string): Prisma.SampleTransferWhereInput {
  const range = timestampRange(day, day);
  return { OR: [{ sendDate: range }, { sendDate: null, createdAt: range }] };
}

/**
 * The transfer conditions of a list query, grouped per transfer kind so each kind is one
 * {@link TransferMatch} (a kind without any of its filters is not listed).
 */
export function transferMatches(
  query: Partial<ListSamplesDto>,
): TransferMatch[] {
  const matches: TransferMatch[] = [];
  const add = (
    kind: TransferKind,
    conditions: Prisma.SampleTransferWhereInput[],
    sampleStatus?: SampleStatus,
  ): void => {
    if (conditions.length > 0) matches.push({ kind, sampleStatus, conditions });
  };

  const internal: Prisma.SampleTransferWhereInput[] = [];
  if (query.destinationBranchId) {
    internal.push({ destinationBranchId: query.destinationBranchId });
  }
  if (query.sendDate) internal.push(dispatchedOn(query.sendDate));
  add(
    TransferKind.INTERNAL,
    internal,
    query.destinationBranchId ? SampleStatus.SENT_INTERNAL : undefined,
  );

  const external: Prisma.SampleTransferWhereInput[] = [];
  const partner = query.externalPartnerName?.trim();
  if (partner) {
    // literal text: `%` and `_` typed by the user are not wildcards
    external.push({
      externalPartnerName: {
        contains: escapeLike(partner),
        mode: 'insensitive',
      },
    });
  }
  if (query.forwardDate) external.push(dispatchedOn(query.forwardDate));
  add(
    TransferKind.EXTERNAL,
    external,
    partner ? SampleStatus.FORWARD_EXTERNAL : undefined,
  );

  const outsource: Prisma.SampleTransferWhereInput[] = [];
  if (query.outsourceCenterId) {
    outsource.push({ outsourceCenterId: query.outsourceCenterId });
  }
  if (query.outsourceDate) outsource.push(dispatchedOn(query.outsourceDate));
  add(TransferKind.OUTSOURCE, outsource);

  return matches;
}

/** The `SampleTransfer` condition of a {@link TransferMatch}: live, of that kind, meeting every condition. */
export function transferWhereOf(
  match: TransferMatch,
): Prisma.SampleTransferWhereInput {
  const [only, ...rest] = match.conditions;
  return {
    deletedAt: null,
    kind: match.kind,
    ...(rest.length === 0 ? only : { AND: match.conditions }),
  };
}

/** Translate the §A.3 "Order Mode" filter into order/sample conditions. */
export function applyOrderMode(
  mode: OrderMode | undefined,
  order: Prisma.OrderWhereInput,
  and: Prisma.OrderSampleWhereInput[],
): void {
  switch (mode) {
    case 'Home Visit':
      order.diagnostics = { is: { isHomeVisit: true } };
      break;
    case 'Emergency':
      order.isUrgentBill = true;
      break;
    case 'Referral':
      order.OR = [
        { internalReferralId: { not: null } },
        { externalReferralId: { not: null } },
      ];
      break;
    case 'Outsource':
      and.push({ status: SampleStatus.OUTSOURCED });
      break;
    case 'Walk-in':
      order.diagnostics = { is: { isHomeVisit: false } };
      break;
    default:
      break;
  }
}

/**
 * "Column is one of these exact values" and/or "column has no value". A blank value
 * (null or empty text) counts as not set. Null when neither is asked for.
 */
function textOrNotSet(
  column: 'sampleName' | 'sampleType',
  values: string[] | undefined,
  notSet: boolean | undefined,
): Prisma.OrderSampleWhereInput | null {
  const clauses: Prisma.OrderSampleWhereInput[] = [];
  if (values?.length) clauses.push({ [column]: { in: values } });
  if (notSet) clauses.push({ OR: [{ [column]: null }, { [column]: '' }] });
  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0]! : { OR: clauses };
}

/**
 * Build the filter conditions of the §A.3 filter panel (no tenant / branch /
 * department scope - the caller adds those). Order-level filters (date range,
 * department, lab test/panel, order mode, home-collection, referrals, collection
 * status) go through the `order` relation; the TAT band is translated to a
 * `createdAt` range; `and` holds the composite conditions (search, urgent,
 * outsource, logistics, transfers) so they don't clobber each other.
 * @param query the list filters (any subset of `ListSamplesDto`)
 * @param tat the branch's TAT thresholds (only read when `tatStatus` is set)
 * @param nowMs "now" in epoch ms (only read when `tatStatus` is set)
 * @param resolved the filters that needed an extra query (category, report status)
 */
export function buildSampleFilterConditions(
  query: Partial<ListSamplesDto>,
  tat: TatThresholds,
  nowMs: number,
  resolved: ResolvedSampleFilters = {},
): SampleFilterConditions {
  const sample: Prisma.OrderSampleWhereInput = {};
  if (query.status) sample.status = query.status;
  if (query.priority) sample.priority = query.priority;
  if (query.orderId) sample.orderId = query.orderId;
  if (query.originBranchId) sample.originBranchId = query.originBranchId;
  if (query.processingBranchId) {
    sample.processingBranchId = query.processingBranchId;
  }
  if (query.containerTypes?.length) {
    sample.containerType = { in: query.containerTypes };
  }
  if (query.storeLocation?.trim()) {
    sample.storeLocation = {
      contains: escapeLike(query.storeLocation.trim()),
      mode: 'insensitive',
    };
  }
  if (query.tatStatus) {
    sample.createdAt = tatCreatedAtRange(query.tatStatus, tat, nowMs);
    if (!query.status) {
      sample.status = { notIn: [...TERMINAL_SAMPLE_STATUSES] };
    }
  }

  const order: Prisma.OrderWhereInput = {};
  if (query.patientId) order.patientId = query.patientId;
  if (query.referredByDoctorId) {
    order.referredByDoctorId = query.referredByDoctorId;
  }
  if (query.referralPanelId) order.referralPanelId = query.referralPanelId;
  if (query.orderType) order.orderType = query.orderType;
  if (query.createdByUserId) order.createdBy = query.createdByUserId;
  if (query.dateFrom || query.dateTo) {
    order.orderDate = {
      ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
    };
  }
  if (query.departmentId || query.branchLabTestId || query.branchLabPanelId) {
    order.items = {
      some: {
        deletedAt: null,
        ...(query.branchLabTestId
          ? { branchLabTestId: query.branchLabTestId }
          : {}),
        ...(query.branchLabPanelId
          ? { branchLabPanelId: query.branchLabPanelId }
          : {}),
        ...(query.departmentId
          ? { branchLabTest: { is: { departmentId: query.departmentId } } }
          : {}),
      },
    };
  }
  if (query.isHomeCollection) {
    order.diagnostics = { is: { isHomeVisit: true } };
  }
  if (query.internalReferralId) {
    order.internalReferralId = query.internalReferralId;
  }
  if (query.externalReferralId) {
    order.externalReferralId = query.externalReferralId;
  }
  if (query.internalReferralBranchId) {
    order.internalReferral = {
      is: { branchId: query.internalReferralBranchId },
    };
  }
  if (query.externalReferralOrganisation) {
    order.externalReferral = {
      is: {
        organisationName: {
          equals: query.externalReferralOrganisation,
          mode: 'insensitive',
        },
      },
    };
  }
  if (query.collectionStatus) {
    // Order-level collection progress (PENDING/PARTIAL/COLLECTED), derived from
    // the order's workflow items — the same rule as the Order Console's
    // `sampleStatus`, applied here through the sample's to-one `order` relation.
    order.AND = [
      ...(Array.isArray(order.AND) ? order.AND : order.AND ? [order.AND] : []),
      buildCollectionProgressWhere(query.collectionStatus),
    ];
  }

  const and: Prisma.OrderSampleWhereInput[] = [];
  if (query.search) {
    const s = query.search;
    and.push({
      OR: [
        { barcode: { contains: s, mode: 'insensitive' } },
        // The Order ID column (`ORD-00717`): finds every sample of that order.
        {
          order: {
            is: { orderCode: { contains: s, mode: 'insensitive' } },
          },
        },
        {
          order: {
            is: {
              patient: {
                is: {
                  OR: [
                    { firstName: { contains: s, mode: 'insensitive' } },
                    { middleName: { contains: s, mode: 'insensitive' } },
                    { lastName: { contains: s, mode: 'insensitive' } },
                    { umId: { contains: s, mode: 'insensitive' } },
                    { mobile: { contains: s, mode: 'insensitive' } },
                  ],
                },
              },
            },
          },
        },
      ],
    });
  }
  if (query.isOutsource) and.push({ status: SampleStatus.OUTSOURCED });
  // Logistics: how a sample TRAVELS is recorded on its transfer (a Send / Forward / Outsource
  // writes it there, never on the sample), so match the transfer of a sample that is out
  // now; the sample's own column is kept as an alternative for older rows.
  if (query.logisticsType) {
    and.push({
      OR: [
        { logisticsType: query.logisticsType },
        {
          status: { in: [...TRANSFERRED_STATUSES] },
          transfers: {
            some: { deletedAt: null, logisticsType: query.logisticsType },
          },
        },
      ],
    });
  }
  // Sent to / forward partner / outsource center / send, forward, outsource date: per kind, ONE
  // transfer must meet every condition (see `TransferMatch`).
  for (const match of transferMatches(query)) {
    and.push({
      ...(match.sampleStatus ? { status: match.sampleStatus } : {}),
      transfers: { some: transferWhereOf(match) },
    });
  }
  // Logistics person: typed on the transfer when a sample is sent / forwarded / outsourced
  // (the sample's own column is kept as an alternative, like the logistics type).
  const person = query.logisticsPerson?.trim();
  if (person) {
    const contains = {
      contains: escapeLike(person),
      mode: 'insensitive' as const,
    };
    and.push({
      OR: [
        { logisticsPerson: contains },
        {
          status: { in: [...TRANSFERRED_STATUSES] },
          transfers: {
            some: { deletedAt: null, logisticsPerson: contains },
          },
        },
      ],
    });
  }
  // Discard method: recorded as the reason of the sample's "discard" history entry.
  if (query.discardMethod?.trim()) {
    and.push({
      statusHistory: {
        some: {
          action: 'discard',
          deletedAt: null,
          reason: { equals: query.discardMethod.trim(), mode: 'insensitive' },
        },
      },
    });
  }
  // Sample name / type: exact spellings (the options list sends all variants of an entry);
  // "Not set" also matches a blank value.
  const nameClause = textOrNotSet(
    'sampleName',
    query.sampleNames,
    query.sampleNameNotSet,
  );
  if (nameClause) and.push(nameClause);
  const typeClause = textOrNotSet(
    'sampleType',
    query.sampleTypes,
    query.sampleTypeNotSet,
  );
  if (typeClause) and.push(typeClause);
  // Resolved by an extra query first (see `ResolvedSampleFilters`).
  if (resolved.labTestIds) and.push({ labTestId: { in: resolved.labTestIds } });
  if (resolved.reportStatusSampleIds) {
    and.push({ id: { in: resolved.reportStatusSampleIds } });
  }
  if (resolved.orderStatusOrderIds) {
    and.push({ orderId: { in: resolved.orderStatusOrderIds } });
  }
  if (query.isUrgent) {
    and.push({
      OR: [
        { priority: { in: [SamplePriority.URGENT, SamplePriority.STAT] } },
        { order: { is: { isUrgentBill: true } } },
      ],
    });
  }
  applyOrderMode(query.orderMode, order, and);

  return { sample, order, and };
}
