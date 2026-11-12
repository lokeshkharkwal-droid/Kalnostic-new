import {
  AgeLimit,
  formatAgeLimit,
  meetsAgeLimit,
} from '../../../common/utils/age-restriction.util';

/** A catalogue line of an order (test or panel), as far as the age gate needs. */
export interface AgeGateLine {
  id?: string | null;
  branchLabTestId?: string | null;
  branchLabPanelId?: string | null;
}

/** A restricted branch test: its name and allowed range. */
export interface RestrictedTest {
  testName: string;
  limit: AgeLimit;
}

/** One order line the patient's age does not qualify for. */
export interface AgeViolation {
  /** Set when the line is a panel: the panel the restricted test belongs to. */
  panelName: string | null;
  /** The restricted test (the line's own test, or the panel member). */
  testName: string;
  /** `"18 Years - 60 Years"` */
  allowedRange: string;
}

/** Everything the gate looked up for the lines being checked. */
export interface AgeGateLookup {
  /** branch test id → restriction (only restricted tests are present). */
  restricted: Map<string, RestrictedTest>;
  /** branch panel id → its member branch test ids (in panel order). */
  panelMembers: Map<string, string[]>;
  /** branch panel id → panel name. */
  panelNames: Map<string, string>;
}

/**
 * The lines of an order update that the age gate must check.
 *
 * - The order becomes a finalized ORDER now (finalize a draft, check-in an
 *   appointment): every effective line — the patched items, or the stored ones
 *   when the patch sends none — so a draft can't be finalized around the gate.
 * - Otherwise only lines that are new to the order: an existing line (same id
 *   AND same test/panel) was accepted when it was added, so editing an older
 *   order is never blocked by a restriction added later.
 *
 * @param incoming the update's items (`undefined` = items untouched)
 * @param stored the order's current live lines (missing = none)
 * @param becomesOrder whether this update finalizes the order
 */
export function linesToAgeCheck(
  incoming: AgeGateLine[] | undefined,
  stored: AgeGateLine[] | null | undefined,
  becomesOrder: boolean,
): AgeGateLine[] {
  const storedLines = stored ?? [];
  if (becomesOrder) return incoming ?? storedLines;
  if (!incoming) return [];
  const storedById = new Map(
    storedLines.filter((s) => s.id).map((s) => [s.id as string, s]),
  );
  return incoming.filter((line) => {
    const prev = line.id ? storedById.get(line.id) : undefined;
    return !(
      prev &&
      (prev.branchLabTestId ?? null) === (line.branchLabTestId ?? null) &&
      (prev.branchLabPanelId ?? null) === (line.branchLabPanelId ?? null)
    );
  });
}

/**
 * The restricted tests among `lines` (a test line's own test; every member of a
 * panel line), in line order, without evaluating any age. Used to decide whether
 * the patient's age is needed at all.
 * @param lines the order lines being checked
 * @param lookup restricted tests + panel members
 */
export function restrictedTestsOf(
  lines: AgeGateLine[],
  lookup: AgeGateLookup,
): Array<{ panelName: string | null; test: RestrictedTest }> {
  const out: Array<{ panelName: string | null; test: RestrictedTest }> = [];
  for (const line of lines) {
    if (line.branchLabTestId) {
      const test = lookup.restricted.get(line.branchLabTestId);
      if (test) out.push({ panelName: null, test });
    } else if (line.branchLabPanelId) {
      const panelName =
        lookup.panelNames.get(line.branchLabPanelId) ?? 'Lab Panel';
      for (const memberId of lookup.panelMembers.get(line.branchLabPanelId) ??
        []) {
        const test = lookup.restricted.get(memberId);
        if (test) out.push({ panelName, test });
      }
    }
  }
  return out;
}

/**
 * Every line the patient's age does not qualify for on the order date. A panel
 * line fails when ANY of its restricted members fails.
 * @param lines the order lines being checked
 * @param lookup restricted tests + panel members
 * @param dob the patient's (exact or implied) date of birth, UTC midnight
 * @param onDay the order date, UTC midnight
 */
export function findAgeViolations(
  lines: AgeGateLine[],
  lookup: AgeGateLookup,
  dob: Date,
  onDay: Date,
): AgeViolation[] {
  return restrictedTestsOf(lines, lookup)
    .filter(({ test }) => !meetsAgeLimit(dob, onDay, test.limit))
    .map(({ panelName, test }) => ({
      panelName,
      testName: test.testName,
      allowedRange: formatAgeLimit(test.limit),
    }));
}

/**
 * The client message for one or more violations, e.g.
 * `Patient's age (5 Years) does not meet the age requirement for "Vitamin B12" (allowed age: 18 Years - 60 Years).`
 * @param patientAge the patient's age on the order date, e.g. `"5 Years"`
 * @param violations at least one violation
 */
export function ageViolationMessage(
  patientAge: string,
  violations: AgeViolation[],
): string {
  const parts = violations.map((v) =>
    v.panelName
      ? `panel "${v.panelName}" (test "${v.testName}" allows age ${v.allowedRange})`
      : `"${v.testName}" (allowed age: ${v.allowedRange})`,
  );
  return `Patient's age (${patientAge}) does not meet the age requirement for ${parts.join(', ')}.`;
}
