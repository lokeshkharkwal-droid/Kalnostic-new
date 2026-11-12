import { SampleStatus } from '@prisma/client';
import {
  buildTransferTimeline,
  endAtReturn,
  inWindow,
  TRANSFER_RETRIEVE_NOTE_PREFIX,
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

describe('buildTransferTimeline - what the RECEIVING branch did', () => {
  const branchName = new Map([
    ['bA', 'Branch A'],
    ['bB', 'Branch B'],
  ]);
  const base = { senderOrigin: 'bA', receiverDestination: 'bB', branchName };
  // the rows are stored on the sender's sample under the SENDER's branch
  const returned = row('r1', '2026-10-22T12:00:00Z', {
    action: 'returned-by-receiver',
    fromStatus: SampleStatus.SENT_INTERNAL,
    toStatus: SampleStatus.SENT_INTERNAL,
    branchId: 'bA',
    reason: 'Clotted',
    notes: 'Returned by the receiving branch: Clotted',
    actorName: 'Ravi',
  });
  const sent = row('s1', '2026-10-22T10:00:00Z', {
    action: 'send',
    branchId: 'bA',
  });

  it('a Repeat is told apart from a Reject and shown at the receiving branch', () => {
    const repeat = buildTransferTimeline({
      ...base,
      sender: [sent, returned],
      steps: [],
      receiver: [],
      returned: 'REPEAT',
    });
    const reject = buildTransferTimeline({
      ...base,
      sender: [sent, returned],
      steps: [],
      receiver: [],
      returned: 'REJECTED',
    });
    expect(repeat[1]).toMatchObject({
      display: 'repeat-requested',
      side: 'receiver',
      branchName: 'Branch B',
      branchId: 'bB',
      actorName: 'Ravi',
      reason: 'Clotted',
    });
    expect(reject[1]).toMatchObject({ display: 'rejected', branchName: 'Branch B' });
  });

  it("a send-back of an EARLIER transfer is named from that transfer, not from this one", () => {
    const tl = buildTransferTimeline({
      ...base,
      sender: [sent, returned],
      steps: [],
      receiver: [],
      returned: null, // this (later) transfer was not sent back
      returnedAt: () => 'REJECTED',
    });
    expect(tl[1]).toMatchObject({ display: 'rejected', branchName: 'Branch B' });
  });

  it('a send-back of unknown kind keeps the general label but still shows the right branch', () => {
    const t = buildTransferTimeline({
      ...base,
      sender: [sent, returned],
      steps: [],
      receiver: [],
    });
    expect(t[1]).toMatchObject({ display: 'returned', branchName: 'Branch B' });
  });

  it("the receiving branch's Retrieve is shown at the receiving branch; the sender's own recall stays the sender's", () => {
    const receiverUndo = row('u1', '2026-10-22T13:00:00Z', {
      action: 'retrieve',
      branchId: 'bA',
      notes: `${TRANSFER_RETRIEVE_NOTE_PREFIX}Accepted to Received (Retrieve)`,
    });
    const senderRecall = row('u2', '2026-10-22T14:00:00Z', {
      action: 'retrieve',
      branchId: 'bA',
      notes: 'Retrieved from Branch B while In-Transit',
    });
    const t = buildTransferTimeline({
      ...base,
      sender: [sent, receiverUndo, senderRecall],
      steps: [],
      receiver: [],
    });
    expect(t[1]).toMatchObject({ display: 'receiver-retrieve', side: 'receiver', branchName: 'Branch B' });
    expect(t[2]!.display).toBeUndefined();
    expect(t[2]).toMatchObject({ side: 'sender', branchName: 'Branch A' });
  });

  it("ordinary sender lines are left exactly as they were", () => {
    const t = buildTransferTimeline({ ...base, sender: [sent], steps: [], receiver: [], returned: 'REPEAT' });
    expect(t[0]).toMatchObject({ side: 'sender', branchName: 'Branch A' });
    expect(t[0]!.display).toBeUndefined();
  });

  it('without a known receiving branch the stored branch is kept', () => {
    const t = buildTransferTimeline({ ...base, receiverDestination: null, sender: [returned], steps: [], receiver: [], returned: 'REPEAT' });
    expect(t[0]!.branchName).toBe('Branch A');
  });
});

describe('endAtReturn', () => {
  // newest first, like the history read
  const rows = [
    { action: 'send' },
    { action: 'accept' },
    { action: 'collect' },
    { action: 'repeat' },
    { action: 'returned-by-receiver' },
    { action: 'send' },
    { action: 'accept' },
  ];

  it('a transfer sent back ends at the send-back: what the sender did next is left out', () => {
    expect(endAtReturn(rows, 'REPEAT').map((r) => r.action)).toEqual(['returned-by-receiver', 'send', 'accept']);
    expect(endAtReturn(rows, 'REJECTED')).toHaveLength(3);
  });

  it('a transfer that was not sent back is left as it is', () => {
    expect(endAtReturn(rows, null)).toHaveLength(rows.length);
  });

  it('a send-back with no matching row changes nothing', () => {
    const noReturn = rows.filter((r) => r.action !== 'returned-by-receiver');
    expect(endAtReturn(noReturn, 'REPEAT')).toHaveLength(noReturn.length);
  });

  it('keeps the newest send-back when there are several', () => {
    const two = [{ action: 'send' }, { action: 'returned-by-receiver' }, { action: 'send' }, { action: 'returned-by-receiver' }, { action: 'collect' }];
    expect(endAtReturn(two, 'REPEAT')).toHaveLength(4);
  });
});
