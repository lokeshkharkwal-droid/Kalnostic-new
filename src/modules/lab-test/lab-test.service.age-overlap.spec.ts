import { AgeUnit, ReferenceGender } from '@prisma/client';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from './lab-test.service';

/**
 * Overlap check on reference-range age bands, as a real save sees it (`assertParam`).
 * Ages are compared on the calendar and "To" covers its whole unit. Only a REAL
 * overlap (shared ages for every birth date) is rejected; a calendar edge that
 * happens for some birth dates only is allowed.
 */
describe('LabTestService — age-band overlap is calendar based and lenient on calendar edges', () => {
  const service = new LabTestService(
    {} as unknown as PrismaService,
    {} as unknown as MasterDataService,
  );
  const priv = service as unknown as {
    assertParam: (p: unknown) => void;
    assertAdapterDefaultsPresent: (r: unknown[], code: string) => void;
  };
  const D = AgeUnit.DAYS;
  const M = AgeUnit.MONTHS;
  const Y = AgeUnit.YEARS;

  const range = (
    ageFrom: number,
    ageFromUnit: AgeUnit,
    ageTo: number,
    ageToUnit: AgeUnit,
    extra: Record<string, unknown> = {},
  ) => ({
    ageFrom,
    ageFromUnit,
    ageTo,
    ageToUnit,
    gender: ReferenceGender.ALL,
    lowerLimit: 12,
    upperLimit: 16,
    isDefault: true,
    ...extra,
  });

  /** 'ACCEPTED' or the validation message. */
  const run = (fn: () => void): string => {
    try {
      fn();
      return 'ACCEPTED';
    } catch (e) {
      const body = (e as ValidationException).getResponse() as {
        error?: { message?: string };
      };
      return body?.error?.message ?? (e as Error).message;
    }
  };
  const save = (...ranges: unknown[]) =>
    run(() =>
      priv.assertParam({ parameterCode: 'HGB', referenceRanges: ranges }),
    );

  describe('rejected: a real overlap', () => {
    it.each([
      [
        '0-28 Days and 20 Days-3 Months',
        range(0, D, 28, D),
        range(20, D, 3, M),
      ],
      ['0-3 Months and 1-11 Months', range(0, M, 3, M), range(1, M, 11, M)],
      ['1-5 Years and 5-10 Years', range(1, Y, 5, Y), range(5, Y, 10, Y)],
      [
        '0-12 Months and 1 Year-5 Years (12 months is exactly 1 year)',
        range(0, M, 12, M),
        range(1, Y, 5, Y),
      ],
      ['0-31 Days and 1-11 Months', range(0, D, 31, D), range(1, M, 11, M)],
    ])('%s', (_label, a, b) => {
      expect(save(a, b)).toMatch(/Overlapping reference range/);
    });

    it('the same range twice is reported as a duplicate', () => {
      expect(save(range(1, Y, 5, Y), range(1, Y, 5, Y))).toMatch(
        /similar reference range already exists/,
      );
    });

    it('12 Months..23 Months and 1 Year..1 Year are the same range, so a duplicate', () => {
      expect(save(range(12, M, 23, M), range(1, Y, 1, Y))).toMatch(
        /similar reference range already exists/,
      );
    });
  });

  describe('accepted: no overlap, or only a calendar edge for some birth dates', () => {
    it.each([
      [
        '0-28 Days and 1-11 Months (overlap only for a baby born in February)',
        range(0, D, 28, D),
        range(1, M, 11, M),
      ],
      [
        '0-30 Days and 1-11 Months (rejected before: shared day 30 in the old 30/365 maths)',
        range(0, D, 30, D),
        range(1, M, 11, M),
      ],
      ['1-4 Years and 5-10 Years', range(1, Y, 4, Y), range(5, Y, 10, Y)],
      ['0-28 Days and 1 Year-5 Years', range(0, D, 28, D), range(1, Y, 5, Y)],
      ['0-11 Months and 1-5 Years', range(0, M, 11, M), range(1, Y, 5, Y)],
      ['0-17 Years and 18-60 Years', range(0, Y, 17, Y), range(18, Y, 60, Y)],
    ])('%s', (_label, a, b) => {
      expect(save(a, b)).toBe('ACCEPTED');
    });

    it('different genders never overlap each other', () => {
      expect(
        save(
          range(0, Y, 999, Y, { gender: ReferenceGender.MALE }),
          range(0, Y, 999, Y, { gender: ReferenceGender.FEMALE }),
        ),
      ).toBe('ACCEPTED');
    });

    it('ALL overlaps both MALE and FEMALE on the same ages', () => {
      expect(
        save(
          range(0, Y, 999, Y),
          range(0, Y, 999, Y, { gender: ReferenceGender.MALE }),
        ),
      ).toMatch(/Overlapping reference range/);
    });
  });

  describe('Default grouping uses the same calendar comparison', () => {
    const defaults = (...r: unknown[]) =>
      run(() => priv.assertAdapterDefaultsPresent(r, 'HGB'));
    const a = { labAdapterId: 'mindray', method: 'M1', unit: 'g/dL' };

    it('"12 Months to 23 Months" and "1 Year to 1 Year" are the SAME band: two Defaults are rejected', () => {
      expect(defaults(range(12, M, 23, M, a), range(1, Y, 1, Y, a))).toMatch(
        /Only one range can be Default/,
      );
    });

    it('the same two bands with no Default are rejected as a group needing one', () => {
      expect(
        defaults(
          range(12, M, 23, M, { ...a, isDefault: false }),
          range(1, Y, 1, Y, { ...a, isDefault: false }),
        ),
      ).toMatch(/Mark a Default range/);
    });

    it('"365 Days to 1 Year" and "1 Year to 1 Year" are different bands (a year is not always 365 days)', () => {
      expect(defaults(range(365, D, 1, Y, a), range(1, Y, 1, Y, a))).toBe(
        'ACCEPTED',
      );
    });

    it('a zero bound is the birth date whatever its unit: "0 Days..1 Year" equals "0 Years..1 Year"', () => {
      expect(defaults(range(0, D, 1, Y, a), range(0, Y, 1, Y, a))).toMatch(
        /Only one range can be Default/,
      );
    });
  });
});
