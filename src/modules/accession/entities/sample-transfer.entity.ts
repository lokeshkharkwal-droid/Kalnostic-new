import { Prisma } from '@prisma/client';

/**
 * Relations included on a sample transfer — the linked sample plus its order /
 * patient / referral context (the referral-queue columns, PDF §B.6/§B.9).
 */
export const TRANSFER_INCLUDE = {
  sample: {
    include: {
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
    },
  },
} satisfies Prisma.SampleTransferInclude;

/** A sample transfer with its sample + order/patient context. */
export type SampleTransferWithRelations = Prisma.SampleTransferGetPayload<{
  include: typeof TRANSFER_INCLUDE;
}>;
