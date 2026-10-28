import { TransferStatus } from '@prisma/client';

/**
 * The sample-transfer state machine (PDF §B.10 — applies to Internal *and*
 * External referrals; §C.2 says External is identical). Each receiving-side action
 * maps the transfer's current `transferStatus` to its next value. The sending side
 * creates a transfer at `IN_TRANSIT` (via the sample's Send/Forward/Outsource
 * action); the universal Retrieve recalls an open transfer (handled in
 * `OrderSampleService.transitionInTx`, not encoded here).
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
  // Reject — sample rejected; origin branch notified. Allowed from Received, and
  // also from Accepted (reject after acceptance). For an INTERNAL transfer the
  // receiving branch's copy is then voided and the report handed back by
  // `SampleTransferService.returnToSender` (refused when a report at the receiver
  // has a validated result, or when the copy was passed on to another branch).
  reject: {
    [TransferStatus.RECEIVED]: TransferStatus.REJECTED,
    [TransferStatus.ACCEPTED]: TransferStatus.REJECTED,
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

/**
 * The **Retrieve** step-back map: each status → the single status it moves back to.
 * Retrieve is a receiving-side *undo* that rewinds the lifecycle one step at a time
 * (repeat until `IN_TRANSIT`); it changes only `transferStatus` + writes a history
 * row — it deliberately does NOT reverse the accept-time clone or any sender-side
 * return (that is the scoped-out heavy recall). `IN_TRANSIT` has no earlier
 * receiving step, so it maps to nothing and Retrieve is not offered there. The
 * send-backs `REPEAT` / `REJECTED` rewind to `RECEIVED`.
 */
export const PREVIOUS_TRANSFER_STATUS: Readonly<
  Partial<Record<TransferStatus, TransferStatus>>
> = {
  [TransferStatus.PICKED_UP]: TransferStatus.IN_TRANSIT,
  [TransferStatus.RECEIVED]: TransferStatus.PICKED_UP,
  [TransferStatus.ACCEPTED]: TransferStatus.RECEIVED,
  [TransferStatus.REPEAT]: TransferStatus.RECEIVED,
  [TransferStatus.REJECTED]: TransferStatus.RECEIVED,
};

/**
 * Resolve the one-step-back target for Retrieve from a current status, or `null`
 * when there is nothing to undo (`IN_TRANSIT`).
 */
export function previousTransferStatus(
  from: TransferStatus,
): TransferStatus | null {
  return PREVIOUS_TRANSFER_STATUS[from] ?? null;
}
