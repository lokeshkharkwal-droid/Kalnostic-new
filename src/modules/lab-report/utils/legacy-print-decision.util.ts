import { AbnormalFlag, ResultType } from '@prisma/client';
import { baseStyleOf } from '../../../common/utils/abnormal-flag.util';
import type { PrintMark } from './print-snapshot.util';

/**
 * How a reading printed BEFORE Abnormal Flag Logic v1.3 (the rules that production runs today).
 * Used ONLY by the one-time backfill (`scripts/backfill-print-snapshots.ts`) that freezes the reports
 * which are already printable, so they keep printing exactly as they do now (manager decision F3).
 *
 * TEMPORARY: delete this file together with the backfill script once every deployment has run it
 * (it reads the old per-range style column and the old `highlightInReport` tick, both dropped by the
 * later clean-up migration).
 *
 * The old rules, copied from the pre-v1.3 code:
 *  - a QUANTITATIVE reading that is a number outside the pinned reference range is styled in that
 *    RANGE's style (never a High/Low word; `abnormal` = true);
 *  - otherwise, on a Qualitative / Semi-Quantitative reading that is not blank, the technician's
 *    "highlight in report" tick styles it in their chosen style, or Bold and Red when none was
 *    chosen (`abnormal` = false);
 *  - everything else printed Normal.
 * The number test is the old `Number()` one (not the stricter comparable-number rule of v1.3).
 *
 * F4: the style NAME is kept, not the old CSS, so an old manual highlight reprints in today's palette.
 */
const NORMAL: PrintMark = { style: null, label: null, abnormal: false };

function oldTrend(
  observed: string | null,
  range: { lowerLimit: unknown; upperLimit: unknown } | undefined,
): 'Low' | 'High' | null {
  if (!range) return null;
  const t = observed === null ? '' : observed.trim();
  const v = t === '' ? NaN : Number(t);
  if (!Number.isFinite(v)) return null;
  const lo = range.lowerLimit == null ? null : Number(range.lowerLimit);
  const hi = range.upperLimit == null ? null : Number(range.upperLimit);
  if (lo === null && hi === null) return null;
  if (
    (lo !== null && !Number.isFinite(lo)) ||
    (hi !== null && !Number.isFinite(hi))
  )
    return null;
  if (lo !== null && v < lo) return 'Low';
  if (hi !== null && v > hi) return 'High';
  return null;
}

/**
 * @param input the reading as it was saved, the range pinned on it (with that range's OLD style column)
 *   and the old highlight tick/style
 * @returns the mark the OLD rules gave this observed value
 */
export function legacyPrintMark(input: {
  resultType: ResultType | null;
  observed: string | null;
  range: { lowerLimit: unknown; upperLimit: unknown } | undefined;
  /** The old `LabTestReferenceRange.abnormalFlagLogic` of the pinned range. */
  rangeStyle: AbnormalFlag | null;
  /** The old per-reading tick (`highlightInReport`) and its chosen style (`highlightLogic`). */
  highlightTick: boolean;
  highlightStyle: AbnormalFlag | null;
}): PrintMark {
  if (input.resultType === ResultType.QUANTITATIVE) {
    if (oldTrend(input.observed, input.range)) {
      return {
        style: baseStyleOf(input.rangeStyle ?? AbnormalFlag.BOLD_AND_RED),
        label: null,
        abnormal: true,
      };
    }
    return NORMAL;
  }
  if (input.highlightTick && (input.observed ?? '').trim() !== '') {
    return {
      style: baseStyleOf(input.highlightStyle ?? AbnormalFlag.BOLD_AND_RED),
      label: null,
      abnormal: false,
    };
  }
  return NORMAL;
}
