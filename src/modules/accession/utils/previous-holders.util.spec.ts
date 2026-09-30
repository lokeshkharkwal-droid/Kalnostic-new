import {
  heldBranchesForCopy,
  isPreviousHolder,
  previousHolderBranchIds,
} from './previous-holders.util';

const sample = (
  branchId: string | null,
  originBranchId: string | null,
  heldBranchIds: string[] = [],
) => ({ branchId, originBranchId, heldBranchIds });

describe('previous-holders util', () => {
  it('a never-transferred sample implies its own and origin branch', () => {
    const s = sample('A', 'A');
    expect(previousHolderBranchIds(s)).toEqual(['A']);
    expect(isPreviousHolder(s, 'A')).toBe(true);
    expect(isPreviousHolder(s, 'B')).toBe(false);
  });

  it('A -> B: the copy at B can never go back to A', () => {
    const atA = sample('A', 'A');
    const atB = sample('B', 'A', heldBranchesForCopy(atA, 'B'));
    expect(isPreviousHolder(atB, 'A')).toBe(true);
    expect(isPreviousHolder(atB, 'B')).toBe(true);
    expect(isPreviousHolder(atB, 'C')).toBe(false);
  });

  it('A -> B -> C: C can go to neither A nor B, but can go to D', () => {
    const atA = sample('A', 'A');
    const atB = sample('B', 'A', heldBranchesForCopy(atA, 'B'));
    const atC = sample('C', 'A', heldBranchesForCopy(atB, 'C'));
    expect(new Set(atC.heldBranchIds)).toEqual(new Set(['A', 'B', 'C']));
    expect(isPreviousHolder(atC, 'A')).toBe(true);
    expect(isPreviousHolder(atC, 'B')).toBe(true);
    expect(isPreviousHolder(atC, 'D')).toBe(false);
  });

  it('a copy with an empty stored list still blocks its sender via the origin branch', () => {
    // e.g. a row the migration could not fill: only origin + own are known
    expect(isPreviousHolder(sample('B', 'A'), 'A')).toBe(true);
  });

  it('does not duplicate branches and ignores a missing destination', () => {
    const copy = heldBranchesForCopy(sample('A', 'A', ['A']), null);
    expect(copy).toEqual(['A']);
  });
});
