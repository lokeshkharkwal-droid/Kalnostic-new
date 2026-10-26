import { Prisma, TransferKind, TransferStatus } from '@prisma/client';
import { SYSTEM_TRANSFER_CLOSE_REASONS } from '../constants/transfer-close-reasons.constant';

/**
 * The `action` of the sender-side history row written when the receiving branch
 * sends a sample back (Reject / Repeat / Return). It records no status change.
 */
export const RETURNED_BY_RECEIVER_ACTION = 'returned-by-receiver';

/** The slice of a Prisma client (or transaction client) these helpers need. */
type ReturnedDb = Pick<Prisma.TransactionClient, 'sampleTransfer'>;

/**
 * What the receiving branch did with a sample it was sent and sent back: it asked
 * for a Repeat, or it Rejected it. The sender's tube stays "Sent" until the sender
 * decides what to do (Repeat after a repeat, Error after a rejection, or Retrieve).
 */
export type ReceiverReturnKind = 'REPEAT' | 'REJECTED';

/** A receiving branch's send-back: what it did and the reason it gave. */
export interface ReceiverReturn {
  kind: ReceiverReturnKind;
  reason: string | null;
}

/** The slice of a transfer row {@link receiverReturnOf} reads. */
export interface ReturnTransferSlice {
  kind: TransferKind;
  transferStatus: TransferStatus;
  rejectionReason: string | null;
  repeatReason: string | null;
}

/**
 * The receiving branch's send-back recorded on a sample's LATEST transfer, or null
 * when that transfer is not one. Only an INTERNAL transfer closed as `REPEAT` or
 * `REJECTED` counts, and a rejection the system wrote itself (a Retrieve, a test
 * removed from the order) is not a decision of the receiving branch.
 * @param latest the sample's newest non-deleted transfer, if any
 */
export function receiverReturnOf(
  latest: ReturnTransferSlice | null | undefined,
): ReceiverReturn | null {
  if (!latest || latest.kind !== TransferKind.INTERNAL) return null;
  if (latest.transferStatus === TransferStatus.REPEAT) {
    return { kind: 'REPEAT', reason: latest.repeatReason };
  }
  if (
    latest.transferStatus === TransferStatus.REJECTED &&
    !SYSTEM_TRANSFER_CLOSE_REASONS.includes(latest.rejectionReason ?? '')
  ) {
    return { kind: 'REJECTED', reason: latest.rejectionReason };
  }
  return null;
}

/**
 * The send-back of each given sample, keyed by sample id (a sample whose latest
 * transfer is not a send-back is absent). One query for the whole set. The caller
 * decides which samples to ask about (those in Sent).
 * @param db Prisma client or transaction client
 * @param tenantId tenant scope
 * @param sampleIds the samples to check (may be empty)
 */
export async function findReceiverReturns(
  db: ReturnedDb,
  tenantId: string,
  sampleIds: string[],
): Promise<Map<string, ReceiverReturn>> {
  const unique = [...new Set(sampleIds)];
  const out = new Map<string, ReceiverReturn>();
  if (unique.length === 0) return out;
  const rows = await db.sampleTransfer.findMany({
    where: {
      tenantId,
      sampleId: { in: unique },
      kind: TransferKind.INTERNAL,
      deletedAt: null,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      sampleId: true,
      kind: true,
      transferStatus: true,
      rejectionReason: true,
      repeatReason: true,
    },
  });
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.sampleId)) continue; // newest first: the first row is the latest
    seen.add(r.sampleId);
    const back = receiverReturnOf(r);
    if (back) out.set(r.sampleId, back);
  }
  return out;
}
