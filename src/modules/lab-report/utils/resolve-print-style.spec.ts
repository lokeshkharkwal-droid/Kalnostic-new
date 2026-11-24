import { AbnormalFlag, ResultFlagOption, ResultType } from '@prisma/client';
import { resolvePrintStyle } from './reference-range.util';

/**
 * Print decision with the parameter style OPTIONAL (manager decision 2026-11-22):
 *  - a blank style + Default prints Normal (nothing to style the reading with);
 *  - Highlight on a blank style falls back to Bold and Red (the technician may have picked another);
 *  - a style that IS set behaves exactly as before.
 */
const RANGE = { lowerLimit: '10', upperLimit: '20' };

const decide = (over: Partial<Parameters<typeof resolvePrintStyle>[0]> = {}) =>
  resolvePrintStyle({
    resultType: ResultType.QUANTITATIVE,
    paramStyle: AbnormalFlag.ITALIC,
    flagOption: ResultFlagOption.DEFAULT,
    selectedStyle: null,
    observed: '25',
    range: RANGE,
    ...over,
  });

describe('resolvePrintStyle - blank parameter style', () => {
  it('Default + out-of-range Quantitative number + blank style prints Normal', () => {
    expect(decide({ paramStyle: null })).toEqual({
      style: null,
      label: null,
      abnormal: false,
    });
    expect(decide({ paramStyle: null, observed: '5' }).style).toBeNull();
  });

  it('the same reading with a style set is still styled and flagged abnormal', () => {
    expect(decide()).toEqual({
      style: AbnormalFlag.ITALIC,
      label: null,
      abnormal: true,
    });
  });

  it('a High Low style adds the word on a styled parameter only', () => {
    expect(decide({ paramStyle: AbnormalFlag.RED_HIGH_LOW }).label).toBe(
      'High',
    );
    expect(
      decide({ paramStyle: AbnormalFlag.RED_HIGH_LOW, observed: '5' }).label,
    ).toBe('Low');
  });

  it('Highlight + blank style + no choice prints the Bold and Red fallback, never a High Low word', () => {
    const d = decide({
      paramStyle: null,
      flagOption: ResultFlagOption.HIGHLIGHT,
    });
    expect(d).toEqual({
      style: AbnormalFlag.BOLD_AND_RED,
      label: null,
      abnormal: false,
    });
  });

  it("Highlight + blank style + the technician's pick prints the pick", () => {
    expect(
      decide({
        paramStyle: null,
        flagOption: ResultFlagOption.HIGHLIGHT,
        selectedStyle: AbnormalFlag.UNDERLINE,
      }).style,
    ).toBe(AbnormalFlag.UNDERLINE);
  });

  it('Highlight on a styled parameter without a pick uses that style (basic form)', () => {
    expect(
      decide({
        paramStyle: AbnormalFlag.RED_HIGH_LOW,
        flagOption: ResultFlagOption.HIGHLIGHT,
      }).style,
    ).toBe(AbnormalFlag.RED_ONLY);
  });

  it('Highlight works on Qualitative and Semi-Quantitative readings with a blank style', () => {
    for (const resultType of [
      ResultType.QUALITATIVE,
      ResultType.SEMI_QUANTITATIVE,
    ]) {
      expect(
        decide({
          resultType,
          paramStyle: null,
          flagOption: ResultFlagOption.HIGHLIGHT,
          observed: 'Positive',
          range: undefined,
        }).style,
      ).toBe(AbnormalFlag.BOLD_AND_RED);
    }
  });

  it('Not Highlight prints Normal whatever the style, blank or set', () => {
    for (const paramStyle of [null, AbnormalFlag.BOLD_ONLY]) {
      expect(
        decide({ paramStyle, flagOption: ResultFlagOption.NOT_HIGHLIGHT })
          .style,
      ).toBeNull();
    }
  });

  it('a blank reading is Normal whatever the option', () => {
    for (const flagOption of Object.values(ResultFlagOption)) {
      expect(
        decide({ paramStyle: null, flagOption, observed: '  ' }).style,
      ).toBeNull();
      expect(decide({ flagOption, observed: null }).style).toBeNull();
    }
  });

  it('a Default reading on a non-Quantitative parameter stays Normal with or without a style', () => {
    for (const paramStyle of [null, AbnormalFlag.BOLD_ONLY]) {
      expect(
        decide({ resultType: ResultType.QUALITATIVE, paramStyle }).style,
      ).toBeNull();
    }
  });
});
