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
          // CANCELLED here tags the row "Order cancelled" and hides the forward steps.
          status: true,
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
 * A transfer with its sample enriched with `departmentLabel` (distinct test
 * department names joined with ", "; null when none resolve).
 */
export type SampleTransferDeptRow = Omit<
  SampleTransferWithRelations,
  'sample'
> & {
  sample: SampleTransferWithRelations['sample'] & {
    departmentLabel: string | null;
  };
};

/**
 * A referral-queue list row — the dept-labelled transfer plus the resolved
 * `outsourceCenterName`. `outsourceCenterId` is a logical ref with no Prisma
 * relation, so the name is resolved separately — and deliberately WITHOUT a
 * `deletedAt` filter, so a historical transfer to a since-deactivated center
 * still shows the center's name instead of surfacing its raw id. Null when the
 * transfer has no center (not yet assigned) or the center no longer exists.
 */
export type SampleTransferListRow = SampleTransferDeptRow & {
  outsourceCenterName: string | null;
  /** True when the test(s) on this transfer's sample were removed from the order (frozen). */
  itemRemoved: boolean;
};

/**
 * A transfer with its sample + order context and the `itemRemoved` flag: true
 * when the test(s) on its sample (or on the receiving branch's copy) were removed
 * from the order. Such a transfer is kept but frozen (all five receiving actions
 * and Assign Center are refused) and shown tagged "Test removed from order".
 */
export type SampleTransferWithFlag = SampleTransferWithRelations & {
  itemRemoved: boolean;
};
