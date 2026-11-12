import type { SampleStatus } from '@prisma/client';
import {
  RETURNED_BY_RECEIVER_ACTION,
  type ReceiverReturnKind,
} from './returned-by-receiver.util';

/**
 * History `action` of the row written on the SENDER's sample when the receiving branch picks an INTERNAL
 * transfer up. It records no status change (from == to); it exists so the Internal Referral timeline can
 * say who picked it up and when.
 */
export const TRANSFER_PICKUP_ACTION = 'transfer-pickup';

/** Same, for the Receive step (the note carries the condition the sample arrived in). */
export const TRANSFER_RECEIVE_ACTION = 'transfer-receive';

/** The step actions this timeline adds to the history. */
export const TRANSFER_STEP_ACTIONS = [
  TRANSFER_PICKUP_ACTION,
  TRANSFER_RECEIVE_ACTION,
] as const;

/**
 * How the note of the sender-side `retrieve` row starts when the RECEIVING branch undoes a step of the
 * transfer (Accepted -> Received ...). The sender's own recall writes a different note, so this is what
 * tells the two apart. Written by `SampleTransferService.retrieveTransfer`, read here.
 */
export const TRANSFER_RETRIEVE_NOTE_PREFIX = 'Transfer moved back from ';

/**
 * A line whose stored action name is too general for the screen: the receiving branch's send-back
 * (stored as one `returned-by-receiver` action for a Repeat and for a Reject alike) and its Retrieve
 * (stored as the sender's `retrieve`). Worked out from the transfer when the timeline is built, so
 * old rows read correctly too and nothing stored changes.
 */
export type TimelineDisplay =
  | 'repeat-requested'
  | 'rejected'
  | 'returned'
  | 'receiver-retrieve';

/** Whose story an entry belongs to. */
export type TimelineSide =
  /** the sending branch's sample (collected, sent, sent back ...) */
  | 'sender'
  /** a step the receiving branch took on the transfer (picked up, received) */
  | 'step'
  /** the receiving branch's own copy (accepted, results, ...) */
  | 'receiver';

/** The columns of a history row the timeline reads (already enriched with the actor's name). */
export interface TimelineSourceRow {
  id: string;
  branchId: string | null;
  action: string;
  fromStatus: SampleStatus | null;
  toStatus: SampleStatus;
  reason: string | null;
  notes: string | null;
  changedBy: string | null;
  createdAt: Date;
  actorName: string | null;
  actorRole: string | null;
}

/** One line of the combined Internal Referral timeline. */
export interface TransferTimelineEntry extends TimelineSourceRow {
  side: TimelineSide;
  /** The branch the entry happened at (named); null when unknown. */
  branchName: string | null;
  /** How the screen labels the line when its action name is too general (see {@link TimelineDisplay}); absent = label from the action. */
  display?: TimelineDisplay;
}

/**
 * The sender's history of ONE transfer, ending where that transfer ended. A transfer the receiving branch
 * sent back (Repeat / Reject) ends at that send-back; what the sender does next (confirm the repeat, collect
 * again, send again) belongs to the next transfer, so it is left out. Any other transfer is left as it is.
 * @param rowsNewestFirst the sender's history rows, newest first (the order `findHistory` returns)
 * @param returned what the receiving branch did with this transfer, null when it sent nothing back
 */
export function endAtReturn<T extends { action: string }>(
  rowsNewestFirst: readonly T[],
  returned: ReceiverReturnKind | null,
): T[] {
  if (!returned) return [...rowsNewestFirst];
  const at = rowsNewestFirst.findIndex(
    (r) => r.action === RETURNED_BY_RECEIVER_ACTION,
  );
  return at < 0 ? [...rowsNewestFirst] : rowsNewestFirst.slice(at);
}

/**
 * The window of one transfer on its sender's sample: from when it was created up to when the NEXT
 * transfer of the same sample was created. A sample sent to B, sent back and then sent to C has two
 * chapters; the timeline of the transfer to B must not drift into the one to C.
 * @param createdAts the creation time of every live transfer of the sample (any order)
 * @returns `end` = the next transfer's creation time, or null when this is the latest one
 */
export function transferWindow(
  transferCreatedAt: Date,
  createdAts: readonly Date[],
): { start: Date; end: Date | null } {
  const later = createdAts
    .filter((d) => d.getTime() > transferCreatedAt.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  return { start: transferCreatedAt, end: later[0] ?? null };
}

/** True when `at` falls inside the window (start inclusive, end exclusive). */
export function inWindow(
  at: Date,
  window: { start: Date; end: Date | null },
): boolean {
  return (
    at.getTime() >= window.start.getTime() &&
    (window.end === null || at.getTime() < window.end.getTime())
  );
}

/**
 * Merge the three stories into ONE timeline, oldest first, each entry labelled with its side and the
 * branch it happened at. At the same instant the sender's entry comes first, then the transfer step,
 * then the receiver's (the order things really happen in).
 * @param senderOrigin the sending branch, used when a sender row carries no branch of its own
 * @param receiverDestination the receiving branch, for step and copy rows without a branch
 * @param branchName id -> name
 */
export function buildTransferTimeline(input: {
  sender: readonly TimelineSourceRow[];
  steps: readonly TimelineSourceRow[];
  receiver: readonly TimelineSourceRow[];
  senderOrigin: string | null;
  receiverDestination: string | null;
  branchName: ReadonlyMap<string, string>;
  /** What the receiving branch did with this transfer (Repeat / Reject), null when nothing. */
  returned?: ReceiverReturnKind | null;
  /**
   * What the receiving branch did with the transfer a send-back row at `at` belongs to. A sample sent twice has
   * two chapters; the later trail still shows the earlier chapter's send-back, and only that earlier transfer
   * knows whether it was a Repeat or a Reject. Falls back to `returned`.
   */
  returnedAt?: (at: Date) => ReceiverReturnKind | null;
}): TransferTimelineEntry[] {
  const label = (id: string | null): string | null =>
    id ? (input.branchName.get(id) ?? null) : null;
  const rank: Record<TimelineSide, number> = {
    sender: 0,
    step: 1,
    receiver: 2,
  };
  const entry = (
    row: TimelineSourceRow,
    side: TimelineSide,
    fallbackBranch: string | null,
  ): TransferTimelineEntry => {
    const branchId = row.branchId ?? fallbackBranch;
    return { ...row, branchId, side, branchName: label(branchId) };
  };
  // Rows the RECEIVING branch caused, stored on the sender's sample under the sender's branch.
  const byReceiver = (r: TimelineSourceRow): boolean =>
    r.action === RETURNED_BY_RECEIVER_ACTION ||
    (r.action === 'retrieve' &&
      (r.notes ?? '').startsWith(TRANSFER_RETRIEVE_NOTE_PREFIX));
  const displayOf = (r: TimelineSourceRow): TimelineDisplay => {
    if (r.action !== RETURNED_BY_RECEIVER_ACTION) return 'receiver-retrieve';
    const kind = input.returnedAt?.(r.createdAt) ?? input.returned ?? null;
    if (kind === 'REPEAT') return 'repeat-requested';
    if (kind === 'REJECTED') return 'rejected';
    return 'returned';
  };
  const senderEntry = (r: TimelineSourceRow): TransferTimelineEntry =>
    byReceiver(r)
      ? {
          ...entry(
            { ...r, branchId: input.receiverDestination ?? r.branchId },
            'receiver',
            input.receiverDestination,
          ),
          display: displayOf(r),
        }
      : entry(r, 'sender', input.senderOrigin);
  return [
    ...input.sender.map(senderEntry),
    ...input.steps.map((r) => entry(r, 'step', input.receiverDestination)),
    ...input.receiver.map((r) =>
      entry(r, 'receiver', input.receiverDestination),
    ),
  ].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      rank[a.side] - rank[b.side] ||
      a.id.localeCompare(b.id),
  );
}
