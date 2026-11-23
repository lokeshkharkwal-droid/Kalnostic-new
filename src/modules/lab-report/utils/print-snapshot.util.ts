import { AbnormalFlag, ResultFlagOption, ResultType } from '@prisma/client';
import { PrintStyleDecision, resolvePrintStyle } from './reference-range.util';

/**
 * The frozen print decision of one reading ("old reports must not change", manager decision 2026-11-22).
 *
 * Written by `validate()` (the only route into a printable status) into
 * `LabReportResultValue.printSnapshot`, and read by the print only while the report is printable.
 * It holds what Master Data could otherwise change under a finished report:
 *  - how Observed 1 and Observed 2 print (style, High/Low word, system-flagged-abnormal tag), and
 *  - the parameter's name, group, order, result type and configured note.
 * It stores the style NAME, never CSS, so a later palette change still applies (an old manual
 * highlight reprints in today's colours). Unit, method, reference text, the observed text and the
 * reference-range row are already saved with the reading itself and need no copy.
 *
 * The JSON is versioned so the shape can grow; a reader refuses what it does not recognise and the
 * print then falls back to the live rules (with a log line) instead of printing garbage.
 */
export const PRINT_SNAPSHOT_VERSION = 1;

/** How one observed value prints. Same shape as the decision `resolvePrintStyle` returns. */
export type PrintMark = PrintStyleDecision;

export interface ResultPrintSnapshot {
  v: typeof PRINT_SNAPSHOT_VERSION;
  /** Observed 1 and Observed 2 are decided separately (a number and a text can differ). */
  o1: PrintMark;
  o2: PrintMark;
  /** Parameter fields frozen with the decision. */
  name: string;
  group: string;
  order: number;
  type: ResultType | null;
  /** The configured (catalogue) Note at validate time, raw text; the technician's own note still wins live. */
  note: string | null;
}

/** The parameter fields the snapshot reads. */
export interface SnapshotParam {
  parameterName: string;
  groupName: string | null;
  sortOrder: number;
  resultType: ResultType | null;
  abnormalFlagLogic: AbnormalFlag | null;
  notes: string | null;
}

/** The reading fields the snapshot reads. */
export interface SnapshotValue {
  observed1: string | null;
  observed2: string | null;
  flagOption: ResultFlagOption;
  highlightLogic: AbnormalFlag | null;
}

/**
 * Freeze one reading, using the SAME decision function the print uses, so a snapshot taken now
 * prints exactly what a live print would right now.
 *
 * @param param the parameter as it is at validate time
 * @param value the saved reading
 * @param range the reference range pinned on the reading (limits only), if any
 * @returns the snapshot to store
 */
export function buildResultPrintSnapshot(
  param: SnapshotParam,
  value: SnapshotValue,
  range: { lowerLimit: unknown; upperLimit: unknown } | undefined,
): ResultPrintSnapshot {
  const decide = (observed: string | null): PrintMark =>
    resolvePrintStyle({
      resultType: param.resultType,
      paramStyle: param.abnormalFlagLogic,
      flagOption: value.flagOption,
      selectedStyle: value.highlightLogic,
      observed,
      range,
    });
  return {
    v: PRINT_SNAPSHOT_VERSION,
    o1: decide(value.observed1),
    o2: decide(value.observed2),
    name: param.parameterName,
    group: param.groupName ?? '',
    order: param.sortOrder,
    type: param.resultType,
    note: param.notes,
  };
}

const STYLES = new Set<string>(Object.values(AbnormalFlag));
const TYPES = new Set<string>(Object.values(ResultType));

function parseMark(raw: unknown): PrintMark | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const style = m.style;
  if (style !== null && !(typeof style === 'string' && STYLES.has(style)))
    return null;
  const label = m.label;
  if (label !== null && label !== 'Low' && label !== 'High') return null;
  if (typeof m.abnormal !== 'boolean') return null;
  return {
    style: style as AbnormalFlag | null,
    label,
    abnormal: m.abnormal,
  };
}

/**
 * Read a stored snapshot back, strictly. Anything that is not exactly a version-1 snapshot is
 * rejected (null), never half-trusted.
 *
 * @param json the raw `printSnapshot` column value
 * @returns the snapshot, or null when there is none or it is not a valid one
 */
export function parseResultPrintSnapshot(
  json: unknown,
): ResultPrintSnapshot | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return null;
  const s = json as Record<string, unknown>;
  if (s.v !== PRINT_SNAPSHOT_VERSION) return null;
  const o1 = parseMark(s.o1);
  const o2 = parseMark(s.o2);
  if (!o1 || !o2) return null;
  if (typeof s.name !== 'string' || typeof s.group !== 'string') return null;
  if (typeof s.order !== 'number' || !Number.isFinite(s.order)) return null;
  const type = s.type;
  if (type !== null && !(typeof type === 'string' && TYPES.has(type)))
    return null;
  if (s.note !== null && typeof s.note !== 'string') return null;
  return {
    v: PRINT_SNAPSHOT_VERSION,
    o1,
    o2,
    name: s.name,
    group: s.group,
    order: s.order,
    type: type as ResultType | null,
    note: s.note,
  };
}
