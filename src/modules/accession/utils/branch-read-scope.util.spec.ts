import {
  branchMayRead,
  branchesWithStake,
  ReadScopeSample,
  ReadScopeTransfer,
} from './branch-read-scope.util';

const sample = (over: Partial<ReadScopeSample> = {}): ReadScopeSample => ({
  branchId: 'A',
  originBranchId: 'A',
  processingBranchId: 'A',
  heldBranchIds: [],
  order: { branchId: 'A' },
  ...over,
});
const transfer = (
  over: Partial<ReadScopeTransfer> = {},
): ReadScopeTransfer => ({
  branchId: 'A',
  originBranchId: 'A',
  destinationBranchId: 'B',
  ...over,
});

describe('branchesWithStake', () => {
  it('an ordinary sample: only its own branch', () => {
    expect([...branchesWithStake(sample(), [])]).toEqual(['A']);
  });

  it('adds the processing branch, the held branches and the order branch', () => {
    const s = sample({
      branchId: 'B',
      originBranchId: 'A',
      processingBranchId: 'C',
      heldBranchIds: ['A', 'B', 'D'],
      order: { branchId: 'E' },
    });
    expect(branchesWithStake(s, [])).toEqual(
      new Set(['A', 'B', 'C', 'D', 'E']),
    );
  });

  it('adds the sender, holder and receiver of every transfer that touches it', () => {
    const stake = branchesWithStake(sample(), [
      transfer({
        branchId: 'A',
        originBranchId: 'A',
        destinationBranchId: 'B',
      }),
      transfer({
        branchId: 'B',
        originBranchId: 'B',
        destinationBranchId: 'C',
      }),
    ]);
    expect(stake).toEqual(new Set(['A', 'B', 'C']));
  });

  it('ignores missing values (no destination yet, no order branch, no order)', () => {
    const stake = branchesWithStake(
      sample({
        branchId: null,
        originBranchId: null,
        processingBranchId: null,
        order: null,
      }),
      [transfer({ destinationBranchId: null })],
    );
    expect(stake).toEqual(new Set(['A']));
  });

  it('a branch that never touched the sample is not in the set', () => {
    const stake = branchesWithStake(
      sample({
        branchId: 'B',
        originBranchId: 'B',
        processingBranchId: 'B',
        order: { branchId: 'B' },
      }),
      [
        transfer({
          branchId: 'B',
          originBranchId: 'B',
          destinationBranchId: 'C',
        }),
      ],
    );
    expect(stake.has('A')).toBe(false);
  });
});

describe('branchMayRead', () => {
  const stake = new Set(['B', 'C']);

  it('a branch in the set may read', () => {
    expect(branchMayRead('B', stake)).toBe(true);
    expect(branchMayRead('C', stake)).toBe(true);
  });

  it('a branch outside the set may not', () => {
    expect(branchMayRead('A', stake)).toBe(false);
  });

  it('a caller with no active branch (business admin) is not restricted', () => {
    expect(branchMayRead(null, stake)).toBe(true);
  });

  it('a call that passes no branch (internal reads) is not restricted', () => {
    expect(branchMayRead(undefined, stake)).toBe(true);
    expect(branchMayRead('', stake)).toBe(true);
  });

  it('an empty set refuses every real branch', () => {
    expect(branchMayRead('A', new Set())).toBe(false);
  });
});
