/**
 * One sample linked to a worklist row, with what is needed to say where it came from.
 */
export interface DisplayBranchSample {
  /** The branch that holds this sample (null for a tenant-level sample). */
  branchId: string | null;
  /** When the sample row was created (a transferred copy is created when the receiver accepts). */
  createdAt: Date;
  /**
   * The branch that SENT this sample, when this sample is a copy made by an accepted
   * internal transfer (the sender of the transfer that created it). Null for an
   * original sample, which nobody sent.
   */
  senderBranchId: string | null;
}

/**
 * Which branch the technician worklist's Branch column shows for the caller.
 *
 * A report is ONE row held by ONE branch, but after an internal transfer each branch
 * has its own sample: the sender keeps its original, every receiver gets a copy made
 * by the transfer. The column shows where the caller's own sample came from:
 *  - a copy: the branch that SENT it (A → B → C: B's row shows A, C's row shows B);
 *  - an original: the caller's own branch (A's row shows A).
 *
 * The caller may cover several branches (an "All Branches" page). Then the sample the
 * report's HOLDER owns wins (that is the branch actually working the report), and
 * otherwise the most recently created one of the caller's samples.
 *
 * @param samples every live sample linked to the row
 * @param viewerBranchIds the branches the caller's request covers
 * @param holderBranchId the branch that holds the report
 * @returns the branch id to show, or null when none of the caller's branches holds a
 *   linked sample (the screen then falls back to the holder's name)
 */
export function pickDisplayBranchId(
  samples: readonly DisplayBranchSample[],
  viewerBranchIds: ReadonlySet<string>,
  holderBranchId: string | null,
): string | null {
  const mine = samples.filter(
    (s) => s.branchId !== null && viewerBranchIds.has(s.branchId),
  );
  if (mine.length === 0) return null;
  const holders =
    holderBranchId === null
      ? []
      : mine.filter((s) => s.branchId === holderBranchId);
  const pool = holders.length > 0 ? holders : mine;
  const chosen = [...pool].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0]!;
  return chosen.senderBranchId ?? chosen.branchId;
}
