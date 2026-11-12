import { SampleStatus as S } from '@prisma/client';
import {
  latestMovementInto,
  resolveRetrieveTarget,
  sortHistoryRows,
  type RetrieveHistoryRow,
} from './retrieve-target.util';
import { barcodeRemovedByRetrieveNote, barcodeRemovedNote } from './repeat-barcode.util';

/**
 * Retrieve = one step back, read from the sample's own history replayed as a stack (a move pushes, a Retrieve pops).
 * `walk` plays a whole life: each step is a move to a status, or `'retrieve'` (go where the rule says, and record it).
 */
type Step = S | 'retrieve';

function life(steps: Step[], first: S = S.NEW) {
  const rows: RetrieveHistoryRow[] = [{ action: 'generate', fromStatus: null, toStatus: first }];
  let current = first;
  const visited: Array<S | 'refused'> = [];
  for (const step of steps) {
    if (step === 'retrieve') {
      const { target, consistent } = resolveRetrieveTarget(rows, current);
      if (!consistent || target === null) {
        visited.push('refused');
        continue;
      }
      rows.push({ action: 'retrieve', fromStatus: current, toStatus: target });
      current = target;
      visited.push(target);
    } else {
      rows.push({ action: 'move', fromStatus: current, toStatus: step });
      current = step;
    }
  }
  return { rows, current, visited };
}

describe('resolveRetrieveTarget - the normal walk-back', () => {
  it('a sample never repeated walks back Accepted -> Collected -> New and then has nothing to go back to', () => {
    const { visited } = life([S.COLLECTED, S.ACCEPTED, 'retrieve', 'retrieve', 'retrieve']);
    expect(visited).toEqual([S.COLLECTED, S.NEW, 'refused']);
  });

  it('a freshly generated sample (only the generate row) has nothing to go back to', () => {
    const { target, consistent } = resolveRetrieveTarget(
      [{ action: 'generate', fromStatus: null, toStatus: S.NEW }],
      S.NEW,
    );
    expect([target, consistent]).toEqual([null, true]);
  });

  it('no history at all: not consistent (the caller falls back)', () => {
    expect(resolveRetrieveTarget([], S.ACCEPTED)).toMatchObject({ target: null, consistent: false });
  });

  it('a Retrieve followed by the same move again walks back the same way (retrieved Accepted, accepted again)', () => {
    const { visited } = life([S.COLLECTED, S.ACCEPTED, 'retrieve', S.ACCEPTED, 'retrieve', 'retrieve']);
    expect(visited).toEqual([S.COLLECTED, S.COLLECTED, S.NEW]);
  });
});

describe('resolveRetrieveTarget - after a Repeat (the loop that was reported)', () => {
  const cycle: Step[] = [S.COLLECTED, S.ACCEPTED, S.REPEAT, S.COLLECTED, S.ACCEPTED];

  it('Repeat -> collect -> accept, then Retrieve x7: back through the second tube, the undone repeat, then the ORIGINAL tube, down to New', () => {
    const { visited } = life([...cycle, ...Array<'retrieve'>(7).fill('retrieve')]);
    // Accepted(2nd) -> Collected(2nd) -> Repeat -> Accepted(original) -> Collected -> New -> nothing earlier -> nothing earlier
    expect(visited).toEqual([S.COLLECTED, S.REPEAT, S.ACCEPTED, S.COLLECTED, S.NEW, 'refused', 'refused']);
  });

  it('it never comes back into the Repeat that was undone', () => {
    const { visited } = life([...cycle, 'retrieve', 'retrieve', 'retrieve', 'retrieve', 'retrieve']);
    expect(visited.slice(3)).toEqual([S.COLLECTED, S.NEW]);
  });

  it('two Repeat cycles: undoing the second one lands on the first cycle Accepted tube, and further Retrieves walk its history', () => {
    const { visited } = life([
      S.COLLECTED, S.ACCEPTED,
      S.REPEAT, S.COLLECTED, S.ACCEPTED, // cycle 1
      S.REPEAT, S.COLLECTED, S.ACCEPTED, // cycle 2
      'retrieve', 'retrieve', 'retrieve', 'retrieve', 'retrieve', 'retrieve', 'retrieve', 'retrieve', 'retrieve',
    ]);
    // cycle 2: Accepted -> Collected -> Repeat -> Accepted(cycle-1 tube) ; cycle 1: -> Collected -> Repeat -> Accepted(original) ; -> Collected -> New
    expect(visited).toEqual([S.COLLECTED, S.REPEAT, S.ACCEPTED, S.COLLECTED, S.REPEAT, S.ACCEPTED, S.COLLECTED, S.NEW, 'refused']);
  });

  it('a Repeat done AFTER an undone Repeat is a new cycle on top of the same stack', () => {
    const { visited, current } = life([
      S.COLLECTED, S.ACCEPTED, S.REPEAT, 'retrieve', // Repeat undone -> Accepted again
      S.REPEAT, S.COLLECTED, S.ACCEPTED, // repeated again
      'retrieve', 'retrieve', 'retrieve',
    ]);
    expect(visited).toEqual([S.ACCEPTED, S.COLLECTED, S.REPEAT, S.ACCEPTED]);
    expect(current).toBe(S.ACCEPTED);
  });

  it('plain Repeat (a Hold in between): Repeat -> Hold -> Collect -> Accept, then Retrieve back through every step', () => {
    const { visited } = life([S.COLLECTED, S.ACCEPTED, S.REPEAT, S.HOLD, S.COLLECTED, S.ACCEPTED, 'retrieve', 'retrieve', 'retrieve', 'retrieve', 'retrieve']);
    expect(visited).toEqual([S.COLLECTED, S.HOLD, S.REPEAT, S.ACCEPTED, S.COLLECTED]);
  });
});

describe('resolveRetrieveTarget - other histories', () => {
  it('rows that change no status (barcode removed / restored, notes) are ignored', () => {
    const rows: RetrieveHistoryRow[] = [
      { action: 'generate', fromStatus: null, toStatus: S.NEW },
      { action: 'collect', fromStatus: S.NEW, toStatus: S.COLLECTED },
      { action: 'assign-barcode', fromStatus: S.COLLECTED, toStatus: S.COLLECTED },
      { action: 'accept', fromStatus: S.COLLECTED, toStatus: S.ACCEPTED },
      { action: 'repeat', fromStatus: S.ACCEPTED, toStatus: S.REPEAT },
      { action: 'barcode-removed', fromStatus: S.REPEAT, toStatus: S.REPEAT },
    ];
    expect(resolveRetrieveTarget(rows, S.REPEAT)).toMatchObject({ target: S.ACCEPTED, consistent: true });
  });

  it("the order's virtual 'cancelled' line is not a move of the sample", () => {
    const rows: RetrieveHistoryRow[] = [
      { action: 'generate', fromStatus: null, toStatus: S.NEW },
      { action: 'collect', fromStatus: S.NEW, toStatus: S.COLLECTED },
      { action: 'order-cancelled', fromStatus: null, toStatus: S.COLLECTED },
    ];
    expect(resolveRetrieveTarget(rows, S.COLLECTED)).toMatchObject({ target: S.NEW, consistent: true });
  });

  it('a forced jump (Collected straight to Accepted-less Store) returns to the status it really left', () => {
    const rows: RetrieveHistoryRow[] = [
      { action: 'generate', fromStatus: null, toStatus: S.NEW },
      { action: 'collect', fromStatus: S.NEW, toStatus: S.COLLECTED },
      // forced: Store straight from Collected (history says from Collected, the stack top was Collected too)
      { action: 'store', fromStatus: S.COLLECTED, toStatus: S.STORED },
    ];
    expect(resolveRetrieveTarget(rows, S.STORED)).toMatchObject({ target: S.COLLECTED, consistent: true });
  });

  it('a gap in the history (the "from" is not what the stack says) still returns to the status the sample left', () => {
    const rows: RetrieveHistoryRow[] = [
      { action: 'generate', fromStatus: null, toStatus: S.NEW },
      // the Collect row is missing
      { action: 'accept', fromStatus: S.COLLECTED, toStatus: S.ACCEPTED },
    ];
    expect(resolveRetrieveTarget(rows, S.ACCEPTED)).toMatchObject({ target: S.COLLECTED, consistent: true });
  });

  it('a sample sent to another branch and retrieved goes on from Accepted', () => {
    const { visited } = life([S.COLLECTED, S.ACCEPTED, S.SENT_INTERNAL, 'retrieve', 'retrieve', 'retrieve']);
    expect(visited).toEqual([S.ACCEPTED, S.COLLECTED, S.NEW]);
  });

  it('a copy born Accepted by a transfer (no "from") has nothing earlier to go back to', () => {
    const rows: RetrieveHistoryRow[] = [{ action: 'transfer-accept', fromStatus: null, toStatus: S.ACCEPTED }];
    expect(resolveRetrieveTarget(rows, S.ACCEPTED)).toMatchObject({ target: null, consistent: true });
  });

  it('a history that does not replay to the current status is reported as not consistent', () => {
    const rows: RetrieveHistoryRow[] = [
      { action: 'generate', fromStatus: null, toStatus: S.NEW },
      { action: 'collect', fromStatus: S.NEW, toStatus: S.COLLECTED },
    ];
    expect(resolveRetrieveTarget(rows, S.ACCEPTED).consistent).toBe(false); // the sample says Accepted, the history says Collected
  });
});

describe('latestMovementInto (the fallback)', () => {
  it('the status the sample came FROM in its latest real move into the current one', () => {
    const rows: RetrieveHistoryRow[] = [
      { action: 'generate', fromStatus: null, toStatus: S.NEW },
      { action: 'collect', fromStatus: S.NEW, toStatus: S.COLLECTED },
      { action: 'accept', fromStatus: S.COLLECTED, toStatus: S.ACCEPTED },
    ];
    expect(latestMovementInto(rows, S.ACCEPTED)).toBe(S.COLLECTED);
  });

  it('skips a Retrieve row, a no-change row and the generate row; null when there is none', () => {
    const rows: RetrieveHistoryRow[] = [
      { action: 'generate', fromStatus: null, toStatus: S.NEW },
      { action: 'assign-barcode', fromStatus: S.NEW, toStatus: S.NEW },
      { action: 'retrieve', fromStatus: S.COLLECTED, toStatus: S.NEW },
    ];
    expect(latestMovementInto(rows, S.NEW)).toBeNull();
  });
});

/**
 * Which barcode does undoing a Repeat put back? Each Repeat is paired with ITS OWN "barcode removed" line, so a sample repeated
 * several times gets its barcodes back one by one, newest Repeat first (the old rule read the newest line every time).
 * `playB` plays a life like `life` does, writing the lines the service writes: a Repeat that took a barcode off writes a
 * "barcode removed" line; a Retrieve back INTO Repeat takes the fresh tube's barcode off and writes a differently worded line.
 */
type StepB = S | 'retrieve' | { repeat: string | null };

function playB(steps: StepB[]) {
  const rows: RetrieveHistoryRow[] = [{ action: 'generate', fromStatus: null, toStatus: S.NEW }];
  let current: S = S.NEW;
  const undone: Array<{ known: boolean; barcode: string | null } | 'refused'> = [];
  for (const step of steps) {
    if (step === 'retrieve') {
      const r = resolveRetrieveTarget(rows, current);
      if (!r.consistent || r.target === null) {
        undone.push('refused');
        continue;
      }
      if (current === S.REPEAT) undone.push(r.repeatBarcode);
      rows.push({ action: 'retrieve', fromStatus: current, toStatus: r.target });
      if (r.target === S.REPEAT) {
        rows.push({
          action: 'barcode-removed',
          fromStatus: S.REPEAT,
          toStatus: S.REPEAT,
          notes: barcodeRemovedByRetrieveNote('FRESH'),
        });
      }
      current = r.target;
    } else if (typeof step === 'object') {
      rows.push({ action: 'repeat', fromStatus: current, toStatus: S.REPEAT });
      if (step.repeat) {
        rows.push({ action: 'barcode-removed', fromStatus: S.REPEAT, toStatus: S.REPEAT, notes: barcodeRemovedNote(step.repeat) });
      }
      current = S.REPEAT;
    } else {
      rows.push({ action: 'move', fromStatus: current, toStatus: step });
      current = step;
    }
  }
  return { rows, current, undone };
}

const R8 = Array<'retrieve'>(8).fill('retrieve');

describe('resolveRetrieveTarget - which barcode undoing a Repeat puts back', () => {
  it('one Repeat: its barcode', () => {
    const { undone } = playB([S.COLLECTED, S.ACCEPTED, { repeat: 'B0' }, 'retrieve']);
    expect(undone).toEqual([{ known: true, barcode: 'B0' }]);
  });

  it('two Repeats, all undone: the newest Repeat first (B1), then the ORIGINAL tube (B0) - not B1 twice', () => {
    const { undone } = playB([
      S.COLLECTED, S.ACCEPTED,
      { repeat: 'B0' }, S.COLLECTED, S.ACCEPTED,
      { repeat: 'B1' }, S.COLLECTED, S.ACCEPTED,
      ...R8,
    ]);
    expect(undone.filter((u) => u !== 'refused')).toEqual([
      { known: true, barcode: 'B1' },
      { known: true, barcode: 'B0' },
    ]);
  });

  it('three Repeats: B2, B1, B0 in that order', () => {
    const cycle = (b: string): StepB[] => [{ repeat: b }, S.COLLECTED, S.ACCEPTED];
    const { undone } = playB([S.COLLECTED, S.ACCEPTED, ...cycle('B0'), ...cycle('B1'), ...cycle('B2'), ...R8, ...R8]);
    expect(undone.filter((u) => u !== 'refused').map((u) => (u as { barcode: string }).barcode)).toEqual(['B2', 'B1', 'B0']);
  });

  it('a Repeat that took NO barcode off: undoing it restores nothing (known), and an older Repeat keeps its own barcode', () => {
    const { undone } = playB([
      S.COLLECTED, S.ACCEPTED,
      { repeat: 'B0' }, S.COLLECTED, S.ACCEPTED,
      { repeat: null }, S.COLLECTED, S.ACCEPTED,
      ...R8,
    ]);
    expect(undone.filter((u) => u !== 'refused')).toEqual([
      { known: true, barcode: null },
      { known: true, barcode: 'B0' },
    ]);
  });

  it('the line a Retrieve writes when it takes the fresh tube barcode off (back into Repeat) is NOT read as a Repeat line', () => {
    // Accepted(B1) -> Collected -> Repeat: the Retrieve removes FRESH; undoing the Repeat must still give B0, not FRESH
    const { undone } = playB([S.COLLECTED, S.ACCEPTED, { repeat: 'B0' }, S.COLLECTED, S.ACCEPTED, 'retrieve', 'retrieve', 'retrieve']);
    expect(undone).toEqual([{ known: true, barcode: 'B0' }]);
  });

  it('a Repeat that was entered by a Retrieve only (the old looping history) cannot be paired: known=false, the caller falls back', () => {
    // old code: ... Repeat undone, then Collected -> Repeat again by Retrieve with no real Repeat behind it
    const rows: RetrieveHistoryRow[] = [
      { action: 'generate', fromStatus: null, toStatus: S.NEW },
      { action: 'collect', fromStatus: S.NEW, toStatus: S.COLLECTED },
      { action: 'accept', fromStatus: S.COLLECTED, toStatus: S.ACCEPTED },
      { action: 'repeat', fromStatus: S.ACCEPTED, toStatus: S.REPEAT },
      { action: 'barcode-removed', fromStatus: S.REPEAT, toStatus: S.REPEAT, notes: barcodeRemovedNote('B0') },
      { action: 'collect', fromStatus: S.REPEAT, toStatus: S.COLLECTED },
      { action: 'accept', fromStatus: S.COLLECTED, toStatus: S.ACCEPTED },
      { action: 'retrieve', fromStatus: S.ACCEPTED, toStatus: S.COLLECTED },
      { action: 'retrieve', fromStatus: S.COLLECTED, toStatus: S.REPEAT },
      { action: 'retrieve', fromStatus: S.REPEAT, toStatus: S.ACCEPTED },
      { action: 'retrieve', fromStatus: S.ACCEPTED, toStatus: S.COLLECTED },
      { action: 'retrieve', fromStatus: S.COLLECTED, toStatus: S.REPEAT },
    ];
    const r = resolveRetrieveTarget(rows, S.REPEAT);
    expect(r.consistent).toBe(true);
    expect(r.repeatBarcode).toEqual({ known: false, barcode: null });
  });

  it('a sample that is not in Repeat: known=false (nothing to pair)', () => {
    const { rows } = playB([S.COLLECTED, S.ACCEPTED]);
    expect(resolveRetrieveTarget(rows, S.ACCEPTED).repeatBarcode).toEqual({ known: false, barcode: null });
  });
});

describe('sortHistoryRows - lines written in the same instant', () => {
  const at = (ms: number) => new Date(1_700_000_000_000 + ms);
  const row = (action: string, from: S | null, to: S, ms: number): RetrieveHistoryRow => ({ action, fromStatus: from, toStatus: to, createdAt: at(ms) });

  it('a "barcode removed" line that sorted (by random id) before its Repeat row is put after it, so it still pairs with that Repeat', () => {
    const removed: RetrieveHistoryRow = { ...row('barcode-removed', S.REPEAT, S.REPEAT, 10), notes: barcodeRemovedNote('B0') };
    const dbOrder = [row('generate', null, S.NEW, 0), row('accept', S.COLLECTED, S.ACCEPTED, 5), removed, row('repeat', S.ACCEPTED, S.REPEAT, 10)];
    // without the sort the line comes before the Repeat and is lost
    expect(resolveRetrieveTarget(dbOrder, S.REPEAT).repeatBarcode).toEqual({ known: true, barcode: null });
    const sorted = sortHistoryRows(dbOrder);
    expect(sorted.map((r) => r.action)).toEqual(['generate', 'accept', 'repeat', 'barcode-removed']);
    expect(resolveRetrieveTarget(sorted, S.REPEAT).repeatBarcode).toEqual({ known: true, barcode: 'B0' });
  });

  it('different instants keep their order; rows with no timestamp are left alone', () => {
    const a = [row('collect', S.NEW, S.COLLECTED, 1), row('assign-barcode', S.COLLECTED, S.COLLECTED, 2), row('accept', S.COLLECTED, S.ACCEPTED, 3)];
    expect(sortHistoryRows(a).map((r) => r.action)).toEqual(['collect', 'assign-barcode', 'accept']);
    const noTime: RetrieveHistoryRow[] = [
      { action: 'repeat', fromStatus: S.ACCEPTED, toStatus: S.REPEAT },
      { action: 'barcode-removed', fromStatus: S.REPEAT, toStatus: S.REPEAT },
    ];
    expect(sortHistoryRows(noTime)).toEqual(noTime);
  });
});

describe('sortHistoryRows - an auto-accepted tube: generate / collect / accept share ONE instant (any stored order)', () => {
  const T0 = new Date(1_700_000_000_000);
  const at = (ms: number) => new Date(T0.getTime() + ms);
  const gen: RetrieveHistoryRow = { action: 'generate', fromStatus: null, toStatus: S.NEW, createdAt: at(0) };
  const col: RetrieveHistoryRow = { action: 'collect', fromStatus: S.NEW, toStatus: S.COLLECTED, createdAt: at(0) };
  const acc: RetrieveHistoryRow = { action: 'accept', fromStatus: S.COLLECTED, toStatus: S.ACCEPTED, createdAt: at(0) };
  const barcode: RetrieveHistoryRow = { action: 'assign-barcode', fromStatus: S.COLLECTED, toStatus: S.COLLECTED, createdAt: at(40) };
  const permutations: RetrieveHistoryRow[][] = [
    [gen, col, acc], [gen, acc, col], [col, gen, acc], [col, acc, gen], [acc, gen, col], [acc, col, gen],
  ];

  it.each(permutations.map((p) => [p.map((r) => r.action).join(' > '), p] as const))('stored as %s -> generate, collect, accept', (_n, stored) => {
    expect(sortHistoryRows([...stored, barcode]).map((r) => r.action)).toEqual(['generate', 'collect', 'accept', 'assign-barcode']);
  });

  it.each(permutations.map((p) => [p.map((r) => r.action).join(' > '), p] as const))('stored as %s -> Retrieve walks Accepted -> Collected -> New and then has nothing to go back to (no loop)', (_n, stored) => {
    const rows: RetrieveHistoryRow[] = sortHistoryRows([...stored, barcode]);
    let current: S = S.ACCEPTED;
    const walk: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = resolveRetrieveTarget(rows, current);
      if (!r.consistent || r.target === null) { walk.push('refused'); continue; }
      rows.push({ action: 'retrieve', fromStatus: current, toStatus: r.target, createdAt: at(100 + i * 10) });
      current = r.target;
      walk.push(r.target);
    }
    expect(walk).toEqual([S.COLLECTED, S.NEW, 'refused', 'refused']);
  });

  it('a Repeat and its "barcode removed" line at one instant keep working (status line first)', () => {
    const rep: RetrieveHistoryRow = { action: 'repeat', fromStatus: S.ACCEPTED, toStatus: S.REPEAT, createdAt: at(10) };
    const removed: RetrieveHistoryRow = { action: 'barcode-removed', fromStatus: S.REPEAT, toStatus: S.REPEAT, notes: barcodeRemovedNote('B0'), createdAt: at(10) };
    const sorted = sortHistoryRows([gen, col, acc, removed, rep]);
    expect(sorted.map((r) => r.action)).toEqual(['generate', 'collect', 'accept', 'repeat', 'barcode-removed']);
    expect(resolveRetrieveTarget(sorted, S.REPEAT).repeatBarcode).toEqual({ known: true, barcode: 'B0' });
  });

  it('a chain with a gap keeps the database order for the rest instead of dropping lines', () => {
    const lone: RetrieveHistoryRow = { action: 'accept', fromStatus: S.HOLD, toStatus: S.ACCEPTED, createdAt: at(0) };
    const out = sortHistoryRows([lone, col]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((r) => r.action))).toEqual(new Set(['accept', 'collect']));
  });

  it('lines at DIFFERENT instants keep the order of their times (nothing is shuffled)', () => {
    const g1: RetrieveHistoryRow = { ...gen, createdAt: at(0) };
    const c1: RetrieveHistoryRow = { ...col, createdAt: at(1) };
    const a1: RetrieveHistoryRow = { ...acc, createdAt: at(2) };
    expect(sortHistoryRows([g1, c1, a1]).map((r) => r.action)).toEqual(['generate', 'collect', 'accept']);
  });
});
