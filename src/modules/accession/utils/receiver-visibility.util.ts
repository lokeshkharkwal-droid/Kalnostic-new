import { Prisma, TransferKind, TransferStatus } from '@prisma/client';

/**
 * "Not decided how it travels yet" rule for INTERNAL transfers: while a transfer is
 * still In-Transit and the sending branch has not chosen a logistics type, the
 * RECEIVING branch must not see it (nor start working on it). It becomes visible the
 * moment a logistics type is set (at Send, or later through Assign / Edit Center).
 *
 * Only the first stage is covered: a transfer already Picked Up, Received, Accepted
 * (or closed) stays visible whatever its logistics - the receiving branch has already
 * seen it. EXTERNAL / OUTSOURCE transfers are never affected.
 */

/** Prisma condition: matches exactly the transfers hidden from the receiving branch. */
export const HIDDEN_FROM_RECEIVER_WHERE: Prisma.SampleTransferWhereInput = {
  kind: TransferKind.INTERNAL,
  transferStatus: TransferStatus.IN_TRANSIT,
  OR: [{ logisticsType: null }, { logisticsType: '' }],
};

/** The slice of a transfer {@link isHiddenFromReceiver} reads. */
export interface ReceiverVisibilitySlice {
  kind: TransferKind;
  transferStatus: TransferStatus;
  logisticsType: string | null;
}

/**
 * Whether the receiving branch must not see / pick up this transfer yet (see the
 * file comment). Mirrors {@link HIDDEN_FROM_RECEIVER_WHERE} for a row already loaded.
 */
export function isHiddenFromReceiver(t: ReceiverVisibilitySlice): boolean {
  return (
    t.kind === TransferKind.INTERNAL &&
    t.transferStatus === TransferStatus.IN_TRANSIT &&
    (t.logisticsType ?? '').trim() === ''
  );
}
