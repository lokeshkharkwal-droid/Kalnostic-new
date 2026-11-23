import { AbnormalFlag, ResultType } from '@prisma/client';
import { legacyPrintMark } from './legacy-print-decision.util';

/** The pre-v1.3 print rules, reproduced for the one-time backfill of already-finished reports. */
const RANGE = { lowerLimit: '70', upperLimit: '110' };
const base = {
  resultType: ResultType.QUANTITATIVE as ResultType | null,
  observed: '150' as string | null,
  range: RANGE as { lowerLimit: unknown; upperLimit: unknown } | undefined,
  rangeStyle: AbnormalFlag.ITALIC as AbnormalFlag | null,
  highlightTick: false,
  highlightStyle: null as AbnormalFlag | null,
};
const mark = (o: Partial<typeof base> = {}) =>
  legacyPrintMark({ ...base, ...o });
const NORMAL = { style: null, label: null, abnormal: false };

describe('legacyPrintMark - Quantitative', () => {
  it('a number above or below the pinned range prints in the RANGE style, flagged abnormal, no High/Low word', () => {
    for (const observed of ['150', '50']) {
      expect(mark({ observed })).toEqual({
        style: AbnormalFlag.ITALIC,
        label: null,
        abnormal: true,
      });
    }
  });

  it('a number inside the range, on the limits, or with nothing to compare prints Normal', () => {
    expect(mark({ observed: '90' })).toEqual(NORMAL);
    expect(mark({ observed: '70' })).toEqual(NORMAL);
    expect(mark({ observed: '110' })).toEqual(NORMAL);
    expect(mark({ range: undefined })).toEqual(NORMAL);
    expect(mark({ range: { lowerLimit: null, upperLimit: null } })).toEqual(
      NORMAL,
    );
  });

  it('text, blank and null readings print Normal', () => {
    for (const observed of ['Hemolysed', '', '   ', null]) {
      expect(mark({ observed })).toEqual(NORMAL);
    }
  });

  it('uses the old Number() test: 1e3 and a padded number compare as numbers', () => {
    expect(mark({ observed: '1e3' }).abnormal).toBe(true);
    expect(mark({ observed: ' 150 ' }).abnormal).toBe(true);
  });

  it('a one-sided range works (only an upper or only a lower limit)', () => {
    expect(
      mark({ range: { lowerLimit: null, upperLimit: '110' } }).abnormal,
    ).toBe(true);
    expect(
      mark({ range: { lowerLimit: '70', upperLimit: null }, observed: '50' })
        .abnormal,
    ).toBe(true);
    expect(mark({ range: { lowerLimit: '70', upperLimit: null } })).toEqual(
      NORMAL,
    );
  });

  it('a High/Low range style is shown as its basic style (the old print never had the word)', () => {
    expect(mark({ rangeStyle: AbnormalFlag.RED_HIGH_LOW })).toEqual({
      style: AbnormalFlag.RED_ONLY,
      label: null,
      abnormal: true,
    });
  });

  it('a missing range style falls back to Bold and Red', () => {
    expect(mark({ rangeStyle: null }).style).toBe(AbnormalFlag.BOLD_AND_RED);
  });

  it('the manual tick never styles a Quantitative reading', () => {
    expect(mark({ observed: '90', highlightTick: true })).toEqual(NORMAL);
  });
});

describe('legacyPrintMark - Qualitative and Semi-Quantitative', () => {
  const qual = (o: Partial<typeof base> = {}) =>
    mark({
      resultType: ResultType.QUALITATIVE,
      observed: 'Positive',
      range: undefined,
      ...o,
    });

  it('prints Normal unless the technician ticked highlight', () => {
    expect(qual()).toEqual(NORMAL);
    expect(qual({ range: RANGE, observed: '150' })).toEqual(NORMAL); // no range styling off Quantitative
  });

  it('a ticked highlight styles the reading in the chosen style, not flagged abnormal', () => {
    expect(
      qual({ highlightTick: true, highlightStyle: AbnormalFlag.UNDERLINE }),
    ).toEqual({
      style: AbnormalFlag.UNDERLINE,
      label: null,
      abnormal: false,
    });
  });

  it('a ticked highlight with no style chosen is Bold and Red', () => {
    expect(qual({ highlightTick: true }).style).toBe(AbnormalFlag.BOLD_AND_RED);
  });

  it('a ticked highlight on a blank reading prints Normal', () => {
    expect(qual({ highlightTick: true, observed: '  ' })).toEqual(NORMAL);
    expect(qual({ highlightTick: true, observed: null })).toEqual(NORMAL);
  });

  it('the same for Semi-Quantitative and for an unknown result type', () => {
    for (const resultType of [ResultType.SEMI_QUANTITATIVE, null]) {
      expect(qual({ resultType, highlightTick: true }).style).toBe(
        AbnormalFlag.BOLD_AND_RED,
      );
    }
  });
});
