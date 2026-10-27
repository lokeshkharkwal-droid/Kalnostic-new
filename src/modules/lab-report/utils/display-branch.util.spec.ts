import {
  pickDisplayBranchId,
  type DisplayBranchSample,
} from './display-branch.util';

/**
 * The worklist's Branch column, per caller. One report is held by one branch; after an
 * internal transfer each branch has its own sample (the sender its original, each
 * receiver a copy). The column shows where the caller's own sample came from.
 */
describe('pickDisplayBranchId', () => {
  const A = 'branch-A';
  const B = 'branch-B';
  const C = 'branch-C';
  const at = (n: number) => new Date(`2026-10-0${n}T10:00:00Z`);

  /** A's original sample (never sent by anyone). */
  const original: DisplayBranchSample = {
    branchId: A,
    createdAt: at(1),
    senderBranchId: null,
  };
  /** B's copy, made when B accepted the transfer A sent. */
  const copyAtB: DisplayBranchSample = {
    branchId: B,
    createdAt: at(2),
    senderBranchId: A,
  };
  /** C's copy, made when C accepted the transfer B sent. */
  const copyAtC: DisplayBranchSample = {
    branchId: C,
    createdAt: at(3),
    senderBranchId: B,
  };
  const pick = (
    samples: DisplayBranchSample[],
    viewers: string[],
    holder: string | null,
  ) => pickDisplayBranchId(samples, new Set(viewers), holder);

  describe('one hop, A -> B (the report is now held by B)', () => {
    const samples = [original, copyAtB];
    it("A's row shows A: A holds the original, nobody sent it", () => {
      expect(pick(samples, [A], B)).toBe(A);
    });
    it("B's row shows A: B's copy was sent by A", () => {
      expect(pick(samples, [B], B)).toBe(A);
    });
  });

  describe('two hops, A -> B -> C (the report is now held by C)', () => {
    const samples = [original, copyAtB, copyAtC];
    it("A's row shows A", () => {
      expect(pick(samples, [A], C)).toBe(A);
    });
    it("B's row shows A: B's copy was sent by A (B's later send to C does not change it)", () => {
      expect(pick(samples, [B], C)).toBe(A);
    });
    it("C's row shows B: C's copy was sent by B, not by the original branch A", () => {
      expect(pick(samples, [C], C)).toBe(B);
    });
  });

  describe('a report that was never transferred', () => {
    it("shows the holder's own branch (its sample is an original)", () => {
      expect(pick([original], [A], A)).toBe(A);
    });
  });

  describe('a caller whose branches hold none of the linked samples', () => {
    it('returns null so the screen falls back to the holder', () => {
      expect(pick([original, copyAtB], [C], B)).toBeNull();
    });
    it('returns null when there are no samples at all', () => {
      expect(pick([], [A], A)).toBeNull();
    });
    it('returns null when the caller covers no branch', () => {
      expect(pick([original], [], A)).toBeNull();
    });
  });

  describe('a caller covering several branches ("All Branches")', () => {
    const samples = [original, copyAtB, copyAtC];
    it("the holder's own sample decides: the branch actually working the report", () => {
      expect(pick(samples, [A, B, C], C)).toBe(B);
    });
    it('when the holder is not among the caller branches, the newest of the caller samples decides', () => {
      expect(pick(samples, [A, B], C)).toBe(A); // B's copy (newest of A's and B's) was sent by A
    });
    it("only the caller's own branches are considered", () => {
      expect(pick(samples, [A], C)).toBe(A);
    });
  });

  describe('edge cases', () => {
    it("a tenant-level sample (no branch) is never the caller's", () => {
      const tenantLevel: DisplayBranchSample = {
        branchId: null,
        createdAt: at(4),
        senderBranchId: null,
      };
      expect(pick([tenantLevel], [A], A)).toBeNull();
    });
    it('a holder-less report (no branch) uses the newest of the caller samples', () => {
      expect(pick([original, copyAtB], [A, B], null)).toBe(A);
    });
    it("a copy whose sender is unknown falls back to the sample's own branch", () => {
      const orphanCopy: DisplayBranchSample = {
        branchId: B,
        createdAt: at(2),
        senderBranchId: null,
      };
      expect(pick([orphanCopy], [B], B)).toBe(B);
    });
    it('two samples of the same branch: the newest one decides', () => {
      const returnedThenResent: DisplayBranchSample = {
        branchId: B,
        createdAt: at(5),
        senderBranchId: C,
      };
      expect(pick([copyAtB, returnedThenResent], [B], B)).toBe(C);
    });
    it('does not change the list it is given', () => {
      const samples = [copyAtC, original, copyAtB];
      const before = samples.map((s) => s.branchId);
      pick(samples, [A, B, C], C);
      expect(samples.map((s) => s.branchId)).toEqual(before);
    });
  });
});
