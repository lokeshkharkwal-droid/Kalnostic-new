import { LabReportStatus } from '@prisma/client';
import {
  followCloneChain,
  pickNotesAnchor,
  reportForSample,
  type OverviewReportRef,
} from './order-overview.util';

const report = (over: Partial<OverviewReportRef> = {}): OverviewReportRef => ({
  id: 'r1',
  status: LabReportStatus.SAVED,
  branchId: 'b1',
  orderItemId: 'i1',
  labTestId: 't1',
  memberBranchLabTestId: null,
  ...over,
});

describe('reportForSample', () => {
  it('a whole-test report belongs to every sample of that order line', () => {
    const r = report({ id: 'r-whole' });
    expect(
      reportForSample([{ orderItemId: 'i1', labTestId: 't1' }], [r], 'b1'),
    ).toBe(r);
    expect(
      reportForSample([{ orderItemId: 'i1', labTestId: 't9' }], [r], 'b1'),
    ).toBe(r);
  });

  it("a panel member's sample matches ITS OWN report, not a sibling's", () => {
    const a = report({
      id: 'ra',
      labTestId: 'tA',
      memberBranchLabTestId: 'mA',
    });
    const b = report({
      id: 'rb',
      labTestId: 'tB',
      memberBranchLabTestId: 'mB',
    });
    expect(
      reportForSample([{ orderItemId: 'i1', labTestId: 'tB' }], [a, b], 'b1'),
    ).toBe(b);
    expect(
      reportForSample([{ orderItemId: 'i1', labTestId: 'tA' }], [a, b], 'b1'),
    ).toBe(a);
  });

  it('no report yet (nothing accepted) is null, and another order line never matches', () => {
    expect(
      reportForSample([{ orderItemId: 'i1', labTestId: 't1' }], [], 'b1'),
    ).toBeNull();
    expect(
      reportForSample(
        [{ orderItemId: 'i2', labTestId: 't1' }],
        [report()],
        'b1',
      ),
    ).toBeNull();
  });

  it('a sent sample still shows the report even though another branch holds it', () => {
    const held = report({
      branchId: 'b-receiver',
      status: LabReportStatus.APPROVED,
    });
    expect(
      reportForSample([{ orderItemId: 'i1', labTestId: 't1' }], [held], 'b1'),
    ).toBe(held);
  });

  it('if two reports match, the one held at the viewer branch wins', () => {
    const other = report({ id: 'r-other', branchId: 'b2' });
    const mine = report({ id: 'r-mine', branchId: 'b1' });
    expect(
      reportForSample(
        [{ orderItemId: 'i1', labTestId: 't1' }],
        [other, mine],
        'b1',
      )?.id,
    ).toBe('r-mine');
  });
});

describe('pickNotesAnchor', () => {
  it('is the first report held at this branch', () => {
    expect(
      pickNotesAnchor(
        [
          report({ id: 'x', branchId: 'b2' }),
          report({ id: 'y', branchId: 'b1' }),
          report({ id: 'z', branchId: 'b1' }),
        ],
        'b1',
      ),
    ).toBe('y');
  });

  it('is null when this branch holds none (nothing accepted here, or every test sent away)', () => {
    expect(pickNotesAnchor([report({ branchId: 'b2' })], 'b1')).toBeNull();
    expect(pickNotesAnchor([], 'b1')).toBeNull();
    expect(pickNotesAnchor([report()], null)).toBeNull();
  });
});

describe('followCloneChain', () => {
  it('no copy: null', () => {
    expect(followCloneChain('s1', new Map())).toBeNull();
  });

  it('one hop: the copy', () => {
    expect(followCloneChain('s1', new Map([['s1', 'c1']]))).toBe('c1');
  });

  it('follows a sample sent on again to the last copy', () => {
    expect(
      followCloneChain(
        's1',
        new Map([
          ['s1', 'c1'],
          ['c1', 'c2'],
        ]),
      ),
    ).toBe('c2');
  });

  it('stops on a cycle and after the hop limit', () => {
    expect(
      followCloneChain(
        's1',
        new Map([
          ['s1', 'c1'],
          ['c1', 's1'],
        ]),
      ),
    ).toBe('c1');
    const chain = new Map(
      Array.from(
        { length: 10 },
        (_, i) => [`n${i}`, `n${i + 1}`] as [string, string],
      ),
    );
    expect(followCloneChain('n0', chain, 3)).toBe('n3');
  });
});
