import { Prisma } from '@prisma/client';

/**
 * Relations included on a sample transfer — the linked sample plus its order /
 * patient / referral context (the referral-queue columns, PDF §B.6/§B.9).
 * `tests` reaches its order item's `branchLabTest`/`branchLabPanel` department
 * id (same path as `SAMPLE_INCLUDE`) so the list can resolve `departmentLabel`.
 */
export const TRANSFER_INCLUDE = {
  sample: {
    include: {
      tests: {
        where: { deletedAt: null },
        include: {
          orderItem: {
            select: {
              branchLabTest: { select: { departmentId: true } },
              branchLabPanel: { select: { departmentId: true } },
            },
          },
        },
      },
      order: {
        select: {
          id: true,
          orderCode: true,
          orderDate: true,
          orderTime: true,
          createdAt: true,
          billId: true,
          patient: true,
          referredByDoctor: true,
          referralPanel: true,
        },
      },
    },
  },
} satisfies Prisma.SampleTransferInclude;

/** A sample transfer with its sample + order/patient context. */
export type SampleTransferWithRelations = Prisma.SampleTransferGetPayload<{
  include: typeof TRANSFER_INCLUDE;
}>;

/**
 * A referral-queue list row — the transfer with its sample enriched with
 * `departmentLabel` (distinct test department names joined with ", "; null
 * when none resolve).
 */
export type SampleTransferListRow = Omit<
  SampleTransferWithRelations,
  'sample'
> & {
  sample: SampleTransferWithRelations['sample'] & {
    departmentLabel: string | null;
  };
};
