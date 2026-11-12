import { SampleStatus } from '@prisma/client';
import { BARCODE_REMOVED_ACTION, barcodeRemovedFrom } from './repeat-barcode.util';

/** The slice of a sample history row the Retrieve rule reads. */
export interface RetrieveHistoryRow {
  action: string;
  fromStatus: SampleStatus | null;
  toStatus: SampleStatus;
  /** Needed only to read the barcode a Repeat took off (its "barcode removed" line). */
  notes?: string | null;
  /** Needed only to sort lines written in the same instant (see {@link sortHistoryRows}). */
  createdAt?: Date | string | null;
}

/** What undoing the Repeat the sample is in now (Retrieve out of Repeat) should do with the barcode. */
export interface RepeatBarcodeUndo {
  /**
   * True when the history says which Repeat is being undone (the sample's current Repeat was entered by a real Repeat). The
   * caller then restores `barcode` (null = that Repeat took off no barcode, so there is nothing to restore). False when it
   * cannot tell (an old history, or a Repeat entered by a Retrieve): the caller falls back to the latest "barcode removed" line.
   */
  known: boolean;
  /** The barcode the Repeat being undone took off. */
  barcode: string | null;
}

export interface RetrieveTarget {
  /**
   * The status the sample goes back to, or null when there is nothing to go back to (it is at its first status).
   * Meaningful only when `consistent` is true.
   */
  target: SampleStatus | null;
  /**
   * Whether the history replays to the sample's CURRENT status. When it does not (rows lost, a status set outside the history),
   * the caller falls back to {@link latestMovementInto}.
   */
  consistent: boolean;
  /** The barcode to put back when the sample is in Repeat and a Retrieve undoes that Repeat. */
  repeatBarcode: RepeatBarcodeUndo;
}

/** One step of the replay: a status the sample was in, and (for a Repeat) the barcode that Repeat took off. */
interface Entry {
  status: SampleStatus;
  barcode: string | null;
  /** Entered by a real Repeat (not by a Retrieve walking back into Repeat). */
  real: boolean;
}

/**
 * Lines written in the same instant (one transaction can be quick, and an auto-accepted tube writes its generate / collect /
 * accept lines in ONE statement, so they share one timestamp to the microsecond) are put in the order they really happened.
 * Ordering by `createdAt` and then the random id alone could put a "barcode removed" line before the Repeat it belongs to, or
 * "accept" before "collect". Two steps:
 *  1. a line that only adds a note (no status change) comes after the lines that change the status;
 *  2. among the status-changing lines of the same instant, the CHAIN of statuses decides: a line that starts from nothing
 *     (generate) first, then the line whose "from" is where the last one ended (New -> Collected before Collected -> Accepted).
 *     If the chain cannot be followed (a gap), the database order is kept for the rest.
 * Rows must be given in the database order (createdAt, id); when a row has no timestamp (a test double) nothing is reordered.
 */
export function sortHistoryRows<T extends RetrieveHistoryRow>(rows: readonly T[]): T[] {
  if (rows.some((r) => r.createdAt == null)) return [...rows];
  const time = (r: T) => new Date(r.createdAt as Date | string).getTime();
  const noChange = (r: T) => (r.fromStatus !== null && r.fromStatus === r.toStatus ? 1 : 0);
  const indexed = rows.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => time(a.r) - time(b.r) || noChange(a.r) - noChange(b.r) || a.i - b.i);
  const sorted = indexed.map((x) => x.r);
  // step 2: reorder every run of status-changing lines that share one instant by following the status chain
  const out: T[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && noChange(sorted[i]!) === 0 && noChange(sorted[j]!) === 0 && time(sorted[j]!) === time(sorted[i]!)) j++;
    out.push(...(j - i > 1 && noChange(sorted[i]!) === 0 ? followChain(sorted.slice(i, j)) : sorted.slice(i, j)));
    i = j;
  }
  return out;
}

/** The status-changing lines of ONE instant, in chain order: a "born" line first, then each line whose "from" is where the last ended. */
function followChain<T extends RetrieveHistoryRow>(run: T[]): T[] {
  const remaining = [...run];
  const result: T[] = [];
  // the start: a line with no "from" (born); else a line whose "from" no other line of the run ends at; else the first
  const takeStart = (): T => {
    const born = remaining.findIndex((r) => r.fromStatus === null);
    if (born >= 0) return remaining.splice(born, 1)[0]!;
    const start = remaining.findIndex((r) => !remaining.some((o) => o !== r && o.toStatus === r.fromStatus));
    return remaining.splice(start >= 0 ? start : 0, 1)[0]!;
  };
  result.push(takeStart());
  while (remaining.length > 0) {
    const last = result[result.length - 1]!;
    const next = remaining.findIndex((r) => r.fromStatus === last.toStatus);
    result.push(remaining.splice(next >= 0 ? next : 0, 1)[0]!);
  }
  return result;
}

/**
 * Where a Retrieve (the universal "one step back") puts a sample, read from its own history.
 *
 * The history is replayed from the oldest row as a STACK of statuses: a move pushes the status it went to, and a Retrieve POPS
 * the status it came from (it cancelled that move). The target is the status below the top. That way a Retrieve that undid a
 * move is never walked through again - the plain "latest move into the current status" rule did not know a Retrieve had
 * cancelled it, so after a Repeat was undone the next Retrieves looped Collected -> Repeat -> Accepted -> Collected ... and the
 * sample never reached New.
 *
 * The same stack answers "which barcode does undoing this Repeat put back?": a Repeat that took a barcode off writes a
 * "barcode removed" line right after its own row, and that line is kept with the Repeat's entry. Undoing a Repeat uses ITS
 * line, so several Repeats of one sample are undone one by one, newest first, each with its own barcode (the old rule always
 * read the newest line and put the same barcode back every time). A "barcode removed" line written by a Retrieve walking back
 * into Repeat belongs to no Repeat and is never used for this (it names a different tube).
 *
 * Rows that change no status (a barcode removed / restored, an assigned barcode, a note) are ignored for the status walk, and
 * so is the order's virtual "cancelled" line. A row with no "from" status (the sample was generated, or a copy was born
 * Accepted by a transfer) starts the stack again. A row whose "from" is not the top of the stack (a forced move from another
 * status, or a gap in the history) first puts that status on the stack, so a Retrieve returns to the status the sample really
 * left.
 * @param rows the sample's history, OLDEST FIRST (see {@link sortHistoryRows})
 * @param current the sample's current status
 */
export function resolveRetrieveTarget(
  rows: readonly RetrieveHistoryRow[],
  current: SampleStatus,
): RetrieveTarget {
  const stack: Entry[] = [];
  const top = (): Entry | undefined => stack[stack.length - 1];
  // a real Repeat was the last status line, so a "barcode removed" line that follows belongs to it
  let repeatLineOpen = false;
  for (const r of rows) {
    if (r.action === 'order-cancelled') continue;
    if (r.action === BARCODE_REMOVED_ACTION) {
      const t = top();
      if (repeatLineOpen && t && t.real && t.status === SampleStatus.REPEAT && t.barcode === null) {
        t.barcode = barcodeRemovedFrom(r.notes);
      }
      repeatLineOpen = false;
      continue;
    }
    if (r.fromStatus !== null && r.fromStatus === r.toStatus) continue; // no status change
    if (r.fromStatus === null) {
      // born (generate / a transferred copy born Accepted): the history starts here
      stack.length = 0;
      stack.push({ status: r.toStatus, barcode: null, real: false });
      repeatLineOpen = false;
      continue;
    }
    if (top()?.status !== r.fromStatus) stack.push({ status: r.fromStatus, barcode: null, real: false });
    if (r.action === 'retrieve') {
      if (stack.length > 1) stack.pop(); // the move being undone
      if (top()?.status !== r.toStatus) stack.push({ status: r.toStatus, barcode: null, real: false });
      repeatLineOpen = false;
    } else {
      stack.push({ status: r.toStatus, barcode: null, real: true });
      repeatLineOpen = r.toStatus === SampleStatus.REPEAT && r.fromStatus !== SampleStatus.REPEAT;
    }
  }
  const t = top();
  return {
    target: stack.length >= 2 ? stack[stack.length - 2]!.status : null,
    consistent: t?.status === current,
    repeatBarcode:
      t && t.status === SampleStatus.REPEAT && t.real
        ? { known: true, barcode: t.barcode }
        : { known: false, barcode: null },
  };
}

/**
 * The status the sample moved FROM in its latest real move into `current` (not a Retrieve, not a no-status-change row). The
 * rule Retrieve used before the stack replay; kept as the fallback for a history that does not replay to the current status.
 * @param rows the sample's history, OLDEST FIRST
 */
export function latestMovementInto(
  rows: readonly RetrieveHistoryRow[],
  current: SampleStatus,
): SampleStatus | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (
      r.action !== 'retrieve' &&
      r.toStatus === current &&
      r.fromStatus !== null &&
      r.fromStatus !== current
    ) {
      return r.fromStatus;
    }
  }
  return null;
}
