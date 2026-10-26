/**
 * Every branch keeps its own copy of a test, so the same test exists once per branch. The Lab Adapter picker shows it
 * once and links all of its copies. Copies are the same test when their **Test Name + Test Code** agree, compared
 * case-insensitively and trimmed — the same rule the equipment auto-map uses (casing / whitespace can drift between
 * branch copies).
 */
const norm = (v: string | null | undefined): string =>
  (v ?? '').trim().toLowerCase();

/** The identity shared by every branch copy of one test. */
export function labTestGroupKey(t: {
  testName: string;
  testCode: string | null;
}): string {
  return `${norm(t.testCode)} ${norm(t.testName)}`;
}

/**
 * Where a test applies, for the picker's hint: `undefined` when only one branch is selected (nothing to tell apart),
 * "All selected branches" when it exists at every selected branch, otherwise the names of the branches that have it.
 */
export function coverageHint(
  copyBranchIds: string[],
  selectedBranchIds: string[],
  branchNames: Map<string, string>,
): string | undefined {
  if (selectedBranchIds.length < 2) return undefined;
  const have = selectedBranchIds.filter((b) => copyBranchIds.includes(b));
  if (have.length === selectedBranchIds.length) return 'All selected branches';
  return have.map((b) => branchNames.get(b) ?? '').join(', ');
}
