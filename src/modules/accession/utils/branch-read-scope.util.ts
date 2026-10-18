/** The sample fields the read-scope rule looks at. */
export interface ReadScopeSample {
  branchId: string | null;
  originBranchId: string | null;
  processingBranchId: string | null;
  heldBranchIds: string[];
  /** The order's own branch (where it was booked). */
  order: { branchId: string | null } | null;
}

/** The branch columns of a transfer that touches the sample. */
export interface ReadScopeTransfer {
  branchId: string | null;
  originBranchId: string | null;
  destinationBranchId: string | null;
}

/**
 * Every branch that has a stake in a sample, so may open it (Sample Overview /
 * History) and its transfers by id: the branch holding it, where it was first
 * created, where it is processed, every branch it has been with, the order's own
 * branch, and the sender / holder / receiver of each transfer that moved it, its
 * copy, or produced it.
 */
export function branchesWithStake(
  sample: ReadScopeSample,
  transfers: ReadScopeTransfer[],
): Set<string> {
  const stake = new Set<string>();
  const add = (id: string | null | undefined): void => {
    if (id) stake.add(id);
  };
  add(sample.branchId);
  add(sample.originBranchId);
  add(sample.processingBranchId);
  sample.heldBranchIds.forEach(add);
  add(sample.order?.branchId);
  for (const t of transfers) {
    add(t.branchId);
    add(t.originBranchId);
    add(t.destinationBranchId);
  }
  return stake;
}

/**
 * True when the caller may read. A caller with no active branch (the business
 * admin, who works tenant-wide) and a call that passes no branch at all (the
 * service's own internal reads) are never restricted.
 */
export function branchMayRead(
  actingBranchId: string | null | undefined,
  stake: Set<string>,
): boolean {
  if (!actingBranchId) return true;
  return stake.has(actingBranchId);
}
