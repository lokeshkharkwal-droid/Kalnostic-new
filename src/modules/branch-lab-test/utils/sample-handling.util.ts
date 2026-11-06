/**
 * Live "Sample Handling Instructions" for a branch Lab Test List copy (the
 * Create-Order Diagnostic Items sample popup).
 *
 * A list copy's `configSnapshot` is frozen at its last Sync, so a value saved in
 * Master Data (Add/Edit Lab Test → Add/Edit Sample) would otherwise not show
 * until a Master Data Sync + Lab Test List Sync. Instead the value is read live
 * from the Master Data sample whose name matches the sample shown on the row.
 */

/** An active Master Data sample (`lab_test_samples`) of a candidate test. */
export interface MasterSampleRow {
  labTestId: string;
  sampleName: string | null;
  sampleHandlingInstructions: string | null;
}

/** Case/whitespace-insensitive sample-name key ("" when there is no name). */
export function normalizeSampleName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Pick the handling instructions for one row.
 *
 * Walks `candidateTestIds` in priority order (Tenant Master Data test first,
 * then the Branch Master Data test) and returns the instructions of the first
 * sample whose name matches `sampleName` — `null` when that matched sample's
 * value is blank (a cleared value never falls back to stale text). When the row
 * has no sample name or no candidate has a matching sample (renamed sample,
 * unlinked copy, deleted source), the row's own snapshot value is kept.
 * @param params.sampleName the sample name shown on the row (snapshot `samples[0]`)
 * @param params.snapshotValue the row's snapshot `sampleHandlingInstructions`
 * @param params.candidateTestIds active Master Data test ids, highest priority first
 * @param params.samplesByTestId active samples per test id (pre-ordered: default first)
 */
export function pickSampleHandlingInstructions(params: {
  sampleName: string | null | undefined;
  snapshotValue: string | null | undefined;
  candidateTestIds: string[];
  samplesByTestId: Map<string, MasterSampleRow[]>;
}): string | null {
  const fallback = params.snapshotValue ?? null;
  const key = normalizeSampleName(params.sampleName);
  if (!key) return fallback;
  for (const testId of params.candidateTestIds) {
    const match = params.samplesByTestId
      .get(testId)
      ?.find((s) => normalizeSampleName(s.sampleName) === key);
    if (match) {
      const value = match.sampleHandlingInstructions;
      return value && value.trim() ? value : null;
    }
  }
  return fallback;
}
