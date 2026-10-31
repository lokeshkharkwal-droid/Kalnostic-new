import type { SampleStatus } from '@prisma/client';

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
  return [
    ...input.sender.map((r) => entry(r, 'sender', input.senderOrigin)),
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
