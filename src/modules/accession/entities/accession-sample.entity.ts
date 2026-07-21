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
      billId: true,
      patient: true,
      referredByDoctor: true,
      referralPanel: true,
    },
  },
} satisfies Prisma.AccessionSampleInclude;

/** Full relations for a single accession sample (Sample Overview — PDF §A.10.4). */
export const SAMPLE_INCLUDE = {
  tests: true,
  statusHistory: { orderBy: { createdAt: 'desc' } },
  transfers: { orderBy: { createdAt: 'desc' } },
  order: {
    select: {
      id: true,
      orderCode: true,
      billId: true,
      patient: true,
      referredByDoctor: true,
      referralPanel: true,
    },
  },
} satisfies Prisma.AccessionSampleInclude;

/** An accession sample list row with its test links + order/patient context. */
export type AccessionSampleListRow = Prisma.AccessionSampleGetPayload<{
  include: typeof SAMPLE_LIST_INCLUDE;
}>;

/** A fully-composed accession sample (tests + history + transfers + order). */
export type AccessionSampleWithRelations = Prisma.AccessionSampleGetPayload<{
  include: typeof SAMPLE_INCLUDE;
}>;

/** A list row enriched with its derived TAT band (§A.4 — not stored). */
export type AccessionSampleListItem = AccessionSampleListRow & {
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
