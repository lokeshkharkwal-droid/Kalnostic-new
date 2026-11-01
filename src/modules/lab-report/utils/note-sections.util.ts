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
 * Whether the Notes sections are selected to print BY DEFAULT for this kind of
 * report: the Lab Panel switch for a report on a panel line, the Lab Test switch
 * for a single test (ON = all selected, OFF = none selected). The checkboxes show
 * either way and the technician can change the selection. A free-text line has no
 * Notes at all, so no switch applies.
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
 * The sections to leave out of the printed report. Once a choice was made
 * (`hasChosen`) it is the stored list. Until then the branch's setting decides:
 * selected by default (ON) leaves nothing out, not selected by default (OFF)
 * leaves every section out.
 *
 * @param selectedByDefault the matching Lab Test / Lab Panel setting (see {@link notesSelectableFor})
 * @param hasChosen the technician (or the approval) has settled the choice on this report
 * @param stored the sections left out, meaningful only when `hasChosen`
 */
export function excludedSectionsToApply(
  selectedByDefault: boolean,
  hasChosen: boolean,
  stored: readonly string[] | null | undefined,
): Set<NoteSectionKey> {
  if (hasChosen) return new Set(normaliseNoteSections(stored));
  return selectedByDefault
    ? new Set<NoteSectionKey>()
    : new Set<NoteSectionKey>(NOTE_SECTION_KEYS);
}
