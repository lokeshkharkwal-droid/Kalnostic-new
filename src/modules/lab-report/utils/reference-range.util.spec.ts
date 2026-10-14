import { AbnormalFlag, ResultType } from '@prisma/client';
import {
  abnormalFlagStyle,
  computeTrendFlag,
  isObservedAbnormal,
} from './reference-range.util';

describe('abnormalFlagStyle', () => {
  it('maps every AbnormalFlag to its inline CSS', () => {
    expect(abnormalFlagStyle(AbnormalFlag.BOLD_AND_RED)).toBe(
      'font-weight:bold;color:#d32f2f',
    );
    expect(abnormalFlagStyle(AbnormalFlag.BOLD_ONLY)).toBe('font-weight:bold');
    expect(abnormalFlagStyle(AbnormalFlag.ITALIC)).toBe('font-style:italic');
    expect(abnormalFlagStyle(AbnormalFlag.UNDERLINE)).toBe(
      'text-decoration:underline',
    );
    expect(abnormalFlagStyle(AbnormalFlag.COLOUR_HIGHLIGHT)).toBe(
      'background-color:#fff176',
    );
  });

  it('covers every enum member (no unmapped value)', () => {
    for (const flag of Object.values(AbnormalFlag)) {
      expect(abnormalFlagStyle(flag).length).toBeGreaterThan(0);
    }
  });
});

describe('computeTrendFlag (abnormal-styling decision)', () => {
  const range = { lowerLimit: 10, upperLimit: 20 };

  it('flags a reading below the lower limit as Low', () => {
    expect(computeTrendFlag('9', range)).toBe('Low');
  });

  it('flags a reading above the upper limit as High', () => {
    expect(computeTrendFlag('21', range)).toBe('High');
  });

  it('treats an in-range reading (incl. the bounds) as Normal', () => {
    expect(computeTrendFlag('15', range)).toBe('Normal');
    expect(computeTrendFlag('10', range)).toBe('Normal');
    expect(computeTrendFlag('20', range)).toBe('Normal');
  });

  it('returns null for a non-numeric (qualitative) reading', () => {
    expect(computeTrendFlag('Positive', range)).toBeNull();
  });

  it('treats a blank reading as no value, NOT as 0 (empty Observed 2)', () => {
    // Regression: Number('') === 0, which would wrongly flag an empty reading
    // as Low for any range whose lower limit is above zero.
    expect(computeTrendFlag('', range)).toBeNull();
    expect(computeTrendFlag('   ', range)).toBeNull();
    expect(computeTrendFlag(null, range)).toBeNull();
  });

  it('trims surrounding whitespace around a real number', () => {
    expect(computeTrendFlag(' 9 ', range)).toBe('Low');
    expect(computeTrendFlag(' 15 ', range)).toBe('Normal');
  });

  it('returns null for a reading that is not a plain number', () => {
    // Can only numerically compare a plain number — "1,200", "<5", "12 mg"
    // etc. are left unstyled rather than mis-parsed.
    expect(computeTrendFlag('1,200', range)).toBeNull();
    expect(computeTrendFlag('<5', range)).toBeNull();
    expect(computeTrendFlag('12.5 mg', range)).toBeNull();
  });

  it('returns null when there is no resolved range', () => {
    expect(computeTrendFlag('15', undefined)).toBeNull();
  });

  it('returns null when both bounds are missing', () => {
    expect(
      computeTrendFlag('15', { lowerLimit: null, upperLimit: null }),
    ).toBeNull();
  });

  it('respects a one-sided range (upper only)', () => {
    const upperOnly = { lowerLimit: null, upperLimit: 20 };
    expect(computeTrendFlag('25', upperOnly)).toBe('High');
    expect(computeTrendFlag('5', upperOnly)).toBe('Normal');
  });
});

describe('isObservedAbnormal (shared tag + styling decision)', () => {
  const range = { lowerLimit: 10, upperLimit: 20 };

  it('is true for a quantitative reading outside the range', () => {
    expect(isObservedAbnormal('9', ResultType.QUANTITATIVE, range)).toBe(true);
    expect(isObservedAbnormal('21', ResultType.QUANTITATIVE, range)).toBe(true);
  });

  it('is false for an in-range quantitative reading', () => {
    expect(isObservedAbnormal('15', ResultType.QUANTITATIVE, range)).toBe(
      false,
    );
  });

  it('is false for a qualitative/semi-quantitative parameter', () => {
    expect(isObservedAbnormal('9', ResultType.QUALITATIVE, range)).toBe(false);
    expect(isObservedAbnormal('9', ResultType.SEMI_QUANTITATIVE, range)).toBe(
      false,
    );
  });

  it('is false for a blank reading or a missing range/type', () => {
    expect(isObservedAbnormal('', ResultType.QUANTITATIVE, range)).toBe(false);
    expect(isObservedAbnormal('9', ResultType.QUANTITATIVE, undefined)).toBe(
      false,
    );
    expect(isObservedAbnormal('9', undefined, range)).toBe(false);
  });
});
