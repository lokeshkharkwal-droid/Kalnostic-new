import type { NotesPrintSwitches } from '../../technician-settings/technician-settings.service';

/**
 * The five Notes sections of a report, as the keys the printed template and the
 * "left out" list use (the same names as the `{useful_for}` … `{references}`
 * template tags). Their order here is the order they show on the report.
 */
export const NOTE_SECTION_KEYS = [
  'useful_for',
  'interpretation',
  'limitations',
  'remarks',
  'references',
] as const;

export type NoteSectionKey = (typeof NOTE_SECTION_KEYS)[number];

/**
 * Notes-print switches already read during ONE print, by branch id. Print All
 * renders many reports at once; sharing this map makes it read each branch's
 * settings once instead of once per report.
 */
export type NotesSwitchCache = Map<string, Promise<NotesPrintSwitches>>;

/** What an order line is: a single test, a lab panel, or free text. */
export type ReportKind = 'TEST' | 'PANEL' | 'DIRECT';

/**
 * Whether a report belongs to a single test, to a lab panel, or to a free-text
 * line. The ONE rule is the order line the report hangs on: a panel order line
 * has `branchLabPanelId`, a single-test line has `branchLabTestId`, a free-text
 * line has neither. It is deliberately NOT `LabReport.memberBranchLabTestId`:
 * reports made before the per-member-test split have no member id yet still sit
 * on a panel line.
 */
export function reportKindOfItem(item: {
  branchLabPanelId: string | null;
  branchLabTestId: string | null;
}): ReportKind {
  if (item.branchLabPanelId) return 'PANEL';
  if (item.branchLabTestId) return 'TEST';
  return 'DIRECT';
}

/**
 * Whether the technician may choose which Notes sections print for this kind of
 * report: the Lab Panel switch for a report on a panel line, the Lab Test switch
 * for a single test. A free-text line has no Notes at all, so no switch applies.
 */
export function notesSelectableFor(
  kind: ReportKind,
  switches: NotesPrintSwitches,
): boolean {
  if (kind === 'PANEL') return switches.labPanel;
  if (kind === 'TEST') return switches.labTest;
  return false;
}

/**
 * A clean "left out" list: only known section keys, no duplicates, in the
 * canonical section order. Anything unknown is dropped rather than rejected, so
 * an old or hand-edited value can never break a print.
 */
export function normaliseNoteSections(
  keys: readonly string[] | null | undefined,
): NoteSectionKey[] {
  const wanted = new Set(keys ?? []);
  return NOTE_SECTION_KEYS.filter((key) => wanted.has(key));
}

/**
 * The sections to leave out of the printed report. While the matching switch is
 * off, nothing is left out (every section prints, as before), whatever choice
 * was saved earlier on the report.
 */
export function excludedSectionsToApply(
  selectable: boolean,
  stored: readonly string[] | null | undefined,
): Set<NoteSectionKey> {
  return selectable
    ? new Set(normaliseNoteSections(stored))
    : new Set<NoteSectionKey>();
}
