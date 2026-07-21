import { TransferStatus } from '@prisma/client';

/**
 * The sample-transfer state machine (PDF §B.10 — applies to Internal *and*
 * External referrals; §C.2 says External is identical). Each receiving-side action
 * maps the transfer's current `transferStatus` to its next value. The sending side
 * creates a transfer at `IN_TRANSIT` (via the sample's Send/Forward/Outsource
 * action); the universal Retrieve recalls an open transfer (handled in
 * `AccessionSampleService.transitionInTx`, not encoded here).
 */
export type TransferAction =
  | 'pick-up'
  | 'receive'
  | 'accept'
  | 'repeat'
  | 'reject';

/** `{ action: { fromStatus: toStatus } }` — the legal transfer transitions (§B.10). */
export const TRANSFER_TRANSITIONS: Readonly<
  Record<TransferAction, Partial<Record<TransferStatus, TransferStatus>>>
> = {
  // Picked Up — logistics confirms collection from the origin branch.
  'pick-up': {
    [TransferStatus.IN_TRANSIT]: TransferStatus.PICKED_UP,
  },
  // Receive — receiving branch acknowledges physical arrival.
  receive: {
    [TransferStatus.PICKED_UP]: TransferStatus.RECEIVED,
  },
  // Accept — formally accepted; sample clones into the receiving branch's In-House.
  accept: {
    [TransferStatus.RECEIVED]: TransferStatus.ACCEPTED,
  },
  // Repeat — re-collection requested (from Received, or reflected back from Accepted).
  repeat: {
    [TransferStatus.RECEIVED]: TransferStatus.REPEAT,
    [TransferStatus.ACCEPTED]: TransferStatus.REPEAT,
  },
  // Reject — sample rejected; origin branch notified.
  reject: {
    [TransferStatus.RECEIVED]: TransferStatus.REJECTED,
  },
};

/**
 * Resolve the target transfer status for an action from a current status, or
 * `null` when the action is not legal from that status (§B.10).
 */
export function nextTransferStatus(
  action: TransferAction,
  from: TransferStatus,
): TransferStatus | null {
  return TRANSFER_TRANSITIONS[action][from] ?? null;
}
