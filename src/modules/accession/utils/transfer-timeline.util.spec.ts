import { SampleStatus } from '@prisma/client';
import {
  buildTransferTimeline,
  inWindow,
  transferWindow,
  type TimelineSourceRow,
} from './transfer-timeline.util';

const row = (
  id: string,
  at: string,
  over: Partial<TimelineSourceRow> = {},
): TimelineSourceRow => ({
  id,
  branchId: null,
  action: 'collect',
  fromStatus: SampleStatus.NEW,
  toStatus: SampleStatus.COLLECTED,
  reason: null,
  notes: null,
  changedBy: 'p1',
  createdAt: new Date(at),
  actorName: 'Asha',
  actorRole: null,
  ...over,
});

describe('transferWindow / inWindow', () => {
  const t1 = new Date('2026-10-22T10:00:00Z');
  const t2 = new Date('2026-10-25T10:00:00Z');

  it('a transfer that has a later one ends where the later one starts', () => {
    const w = transferWindow(t1, [t1, t2]);
    expect(w).toEqual({ start: t1, end: t2 });
    expect(inWindow(new Date('2026-10-23T00:00:00Z'), w)).toBe(true);
    expect(inWindow(t2, w)).toBe(false); // end is exclusive: that instant belongs to the next chapter
    expect(inWindow(new Date('2026-10-21T00:00:00Z'), w)).toBe(false);
  });

  it('the latest transfer has no end', () => {
    const w = transferWindow(t2, [t1, t2]);
    expect(w.end).toBeNull();
    expect(inWindow(new Date('2027-01-01T00:00:00Z'), w)).toBe(true);
  });
});

describe('buildTransferTimeline', () => {
  const branchName = new Map([
    ['bA', 'Branch A'],
    ['bB', 'Branch B'],
  ]);
  const base = { senderOrigin: 'bA', receiverDestination: 'bB', branchName };

  it('merges the three stories oldest first, each labelled with its side and branch', () => {
    const t = buildTransferTimeline({
      ...base,
      sender: [
        row('s1', '2026-10-22T09:00:00Z'),
        row('s2', '2026-10-22T10:00:00Z', { action: 'send' }),
      ],
      steps: [
        row('p', '2026-10-22T11:00:00Z', {
          action: 'transfer-pickup',
          branchId: 'bB',
        }),
        row('r', '2026-10-22T12:00:00Z', {
          action: 'transfer-receive',
          branchId: 'bB',
        }),
      ],
      receiver: [
        row('c', '2026-10-22T13:00:00Z', { action: 'transfer-accept' }),
      ],
    });
    expect(t.map((e) => [e.id, e.side, e.branchName])).toEqual([
      ['s1', 'sender', 'Branch A'],
      ['s2', 'sender', 'Branch A'],
      ['p', 'step', 'Branch B'],
      ['r', 'step', 'Branch B'],
      ['c', 'receiver', 'Branch B'],
    ]);
  });

  it("a row's own branch wins over the side's default", () => {
    const t = buildTransferTimeline({
      ...base,
      sender: [row('s1', '2026-10-22T09:00:00Z', { branchId: 'bB' })],
      steps: [],
      receiver: [],
    });
    expect(t[0]!.branchName).toBe('Branch B');
  });

  it('at the same instant the sender comes first, then the step, then the receiver', () => {
    const at = '2026-10-22T10:00:00Z';
    const t = buildTransferTimeline({
      ...base,
      sender: [row('z-sender', at)],
      steps: [row('m-step', at)],
      receiver: [row('a-receiver', at)],
    });
    expect(t.map((e) => e.side)).toEqual(['sender', 'step', 'receiver']);
  });

  it('a branch that cannot be named stays null instead of showing an id', () => {
    const t = buildTransferTimeline({
      senderOrigin: 'bX',
      receiverDestination: null,
      branchName,
      sender: [row('s1', '2026-10-22T09:00:00Z')],
      steps: [row('p', '2026-10-22T10:00:00Z')],
      receiver: [],
    });
    expect(t.map((e) => e.branchName)).toEqual([null, null]);
  });

  it('keeps the actor name and never invents a role', () => {
    const t = buildTransferTimeline({
      ...base,
      sender: [
        row('s1', '2026-10-22T09:00:00Z', {
          actorName: 'Asha',
          actorRole: null,
        }),
      ],
      steps: [],
      receiver: [],
    });
    expect(t[0]).toMatchObject({ actorName: 'Asha', actorRole: null });
  });
});
