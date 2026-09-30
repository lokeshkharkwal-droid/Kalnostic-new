/** The sample fields the "previous holder" rule reads. */
export interface HolderSample {
  branchId: string | null;
  originBranchId: string | null;
  heldBranchIds: string[];
}

/**
 * Every branch that has held this sample (chain of transferred copies): the
 * stored list, plus — for a sample that was never transferred, where the list is
 * empty — its own branch and the branch it was first created in.
 */
export function previousHolderBranchIds(sample: HolderSample): string[] {
  const held = new Set<string>(sample.heldBranchIds);
  if (sample.branchId) held.add(sample.branchId);
  if (sample.originBranchId) held.add(sample.originBranchId);
  return [...held];
}

/** True when `destinationBranchId` has already held the sample (or is its own branch). */
export function isPreviousHolder(
  sample: HolderSample,
  destinationBranchId: string,
): boolean {
  return previousHolderBranchIds(sample).includes(destinationBranchId);
}

/**
 * The branch list a receiving copy carries: the sender's list, the sender, the
 * sender's origin and the receiving branch — no duplicates.
 */
export function heldBranchesForCopy(
  source: HolderSample,
  destinationBranchId: string | null,
): string[] {
  const held = new Set<string>(previousHolderBranchIds(source));
  if (destinationBranchId) held.add(destinationBranchId);
  return [...held];
}

export const PREVIOUS_HOLDER_MESSAGE =
  'This sample has already been with that branch and cannot be sent back to it. Use Repeat to return it.';
