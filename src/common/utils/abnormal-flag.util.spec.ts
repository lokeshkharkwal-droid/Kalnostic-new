import { AbnormalFlag, ResultType } from '@prisma/client';
import {
  BASIC_STYLES,
  HIGHLIGHT_FALLBACK_STYLE,
  HIGH_LOW_STYLES,
  baseStyleOf,
  isHighLowStyle,
  isStyleAllowedForResultType,
  styleForResultType,
} from './abnormal-flag.util';

describe('abnormal-flag.util', () => {
  it('splits the 16 styles into 9 basic and 7 High Low, with nothing left over or shared', () => {
    const all = Object.values(AbnormalFlag);
    expect(all).toHaveLength(16);
    expect(BASIC_STYLES).toHaveLength(9);
    expect(HIGH_LOW_STYLES).toHaveLength(7);
    expect(new Set([...BASIC_STYLES, ...HIGH_LOW_STYLES])).toEqual(
      new Set(all),
    );
    expect(BASIC_STYLES.some((s) => HIGH_LOW_STYLES.includes(s))).toBe(false);
  });

  it('keeps Underline and Colour Highlight as basic styles with no High Low variant', () => {
    expect(BASIC_STYLES).toContain(AbnormalFlag.UNDERLINE);
    expect(BASIC_STYLES).toContain(AbnormalFlag.COLOUR_HIGHLIGHT);
    for (const s of HIGH_LOW_STYLES) {
      expect(baseStyleOf(s)).not.toBe(AbnormalFlag.UNDERLINE);
      expect(baseStyleOf(s)).not.toBe(AbnormalFlag.COLOUR_HIGHLIGHT);
    }
  });

  it('maps every High Low style to a distinct basic style, and a basic style to itself', () => {
    const bases = HIGH_LOW_STYLES.map((s) => baseStyleOf(s));
    expect(new Set(bases).size).toBe(7);
    for (const b of bases) expect(BASIC_STYLES).toContain(b);
    expect(baseStyleOf(AbnormalFlag.RED_HIGH_LOW)).toBe(AbnormalFlag.RED_ONLY);
    expect(baseStyleOf(AbnormalFlag.BOLD_AND_RED_HIGH_LOW)).toBe(
      AbnormalFlag.BOLD_AND_RED,
    );
    for (const s of BASIC_STYLES) expect(baseStyleOf(s)).toBe(s);
  });

  it('isHighLowStyle is true only for the seven High Low styles', () => {
    for (const s of HIGH_LOW_STYLES) expect(isHighLowStyle(s)).toBe(true);
    for (const s of BASIC_STYLES) expect(isHighLowStyle(s)).toBe(false);
  });

  it('allows every style on QUANTITATIVE and only basic styles on the other result types', () => {
    for (const s of Object.values(AbnormalFlag)) {
      expect(isStyleAllowedForResultType(s, ResultType.QUANTITATIVE)).toBe(
        true,
      );
    }
    for (const type of [ResultType.QUALITATIVE, ResultType.SEMI_QUANTITATIVE]) {
      for (const s of BASIC_STYLES)
        expect(isStyleAllowedForResultType(s, type)).toBe(true);
      for (const s of HIGH_LOW_STYLES)
        expect(isStyleAllowedForResultType(s, type)).toBe(false);
    }
  });

  it('styleForResultType keeps an allowed style and turns a High Low style into its basic style', () => {
    expect(
      styleForResultType(AbnormalFlag.RED_HIGH_LOW, ResultType.QUALITATIVE),
    ).toBe(AbnormalFlag.RED_ONLY);
    expect(
      styleForResultType(
        AbnormalFlag.BOLD_ITALIC_AND_RED_HIGH_LOW,
        ResultType.SEMI_QUANTITATIVE,
      ),
    ).toBe(AbnormalFlag.BOLD_ITALIC_AND_RED);
    expect(
      styleForResultType(AbnormalFlag.RED_HIGH_LOW, ResultType.QUANTITATIVE),
    ).toBe(AbnormalFlag.RED_HIGH_LOW);
    expect(
      styleForResultType(AbnormalFlag.UNDERLINE, ResultType.QUALITATIVE),
    ).toBe(AbnormalFlag.UNDERLINE);
  });

  it('a blank (null) style is allowed on every result type and stays blank', () => {
    for (const type of Object.values(ResultType)) {
      expect(isStyleAllowedForResultType(null, type)).toBe(true);
      expect(isStyleAllowedForResultType(undefined, type)).toBe(true);
      expect(styleForResultType(null, type)).toBeNull();
    }
  });

  it('the Highlight fallback is Bold and Red', () => {
    expect(HIGHLIGHT_FALLBACK_STYLE).toBe(AbnormalFlag.BOLD_AND_RED);
  });
});
