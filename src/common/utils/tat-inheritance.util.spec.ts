import { TatUnit } from '@prisma/client';
import {
  TatConfig,
  applyTatChanges,
  isTatEmpty,
  isTatEqual,
  pickTat,
  shouldInheritTat,
} from './tat-inheritance.util';

const tat = (
  min: number | null,
  max: number | null,
  unit: TatUnit | null = TatUnit.HOURS,
): TatConfig => ({
  tatMinValue: min,
  tatMinUnit: unit,
  tatMaxValue: max,
  tatMaxUnit: unit,
});

describe('pickTat', () => {
  it('reads the four TAT columns, ignoring other fields', () => {
    expect(
      pickTat({ ...tat(2, 6), testName: 'RA Factor' } as TatConfig),
    ).toEqual(tat(2, 6));
  });

  it('reads missing fields as null', () => {
    expect(pickTat({})).toEqual(tat(null, null, null));
  });
});

describe('applyTatChanges', () => {
  it('applies defined fields over the current TAT', () => {
    expect(applyTatChanges(tat(2, 6), { tatMaxValue: 8 })).toEqual({
      ...tat(2, 6),
      tatMaxValue: 8,
    });
  });

  it('leaves a field unchanged when the payload holds it as undefined', () => {
    // Hydrated DTO instances carry declared optional fields as own `undefined`s.
    expect(
      applyTatChanges(tat(2, 6), {
        tatMinValue: undefined,
        tatMinUnit: undefined,
        tatMaxValue: undefined,
        tatMaxUnit: undefined,
      }),
    ).toEqual(tat(2, 6));
  });

  it('clears a field set to null', () => {
    expect(applyTatChanges(tat(2, 6), { tatMinValue: null })).toEqual({
      ...tat(2, 6),
      tatMinValue: null,
    });
  });
});

describe('isTatEqual / isTatEmpty', () => {
  it('compares values and units', () => {
    expect(isTatEqual(tat(2, 6), tat(2, 6))).toBe(true);
    expect(isTatEqual(tat(2, 6), tat(2, 8))).toBe(false);
    expect(isTatEqual(tat(2, 6), tat(2, 6, TatUnit.DAYS))).toBe(false);
  });

  it('treats a config with both values null as empty regardless of unit', () => {
    expect(isTatEmpty(tat(null, null))).toBe(true);
    expect(isTatEmpty(tat(null, null, null))).toBe(true);
    expect(isTatEmpty(tat(2, null))).toBe(false);
    expect(isTatEmpty(tat(null, 6))).toBe(false);
  });
});

describe('shouldInheritTat', () => {
  it('fills an empty copy (never configured / stale)', () => {
    expect(shouldInheritTat(tat(null, null), tat(2, 6), tat(2, 6))).toBe(true);
    expect(
      shouldInheritTat(tat(null, null, null), tat(null, null), tat(2, 6)),
    ).toBe(true);
  });

  it('follows the master when the copy still equals the previous master TAT', () => {
    expect(shouldInheritTat(tat(2, 6), tat(2, 6), tat(4, 8))).toBe(true);
  });

  it('keeps a branch-customised copy', () => {
    expect(shouldInheritTat(tat(1, 3), tat(2, 6), tat(4, 8))).toBe(false);
    expect(
      shouldInheritTat(tat(2, 6, TatUnit.DAYS), tat(2, 6), tat(4, 8)),
    ).toBe(false);
  });

  it('skips a copy that already equals the new master TAT', () => {
    expect(shouldInheritTat(tat(4, 8), tat(2, 6), tat(4, 8))).toBe(false);
  });

  it('does not write an empty copy when the master TAT is also empty', () => {
    expect(
      shouldInheritTat(tat(null, null), tat(null, null), tat(null, null)),
    ).toBe(false);
    // Only the default unit differs (HOURS vs null) — nothing meaningful to copy.
    expect(
      shouldInheritTat(tat(null, null), tat(null, null), tat(null, null, null)),
    ).toBe(false);
  });

  it('clears a non-customised copy when the master TAT is cleared', () => {
    expect(shouldInheritTat(tat(2, 6), tat(2, 6), tat(null, null))).toBe(true);
  });
});
