import { AgeUnit } from '@prisma/client';
import { ValidationException } from '../../../common/exceptions/kaltros.exception';
import {
  AgeRestrictionColumns,
  resolveAgeRestriction,
} from './age-restriction.util';

describe('resolveAgeRestriction', () => {
  const NONE: AgeRestrictionColumns = {
    isAgeRestricted: false,
    minAgeValue: null,
    minAgeUnit: null,
    maxAgeValue: null,
    maxAgeUnit: null,
  };
  /** The client message a KaltrosException carries (not `Error.message`). */
  const messageOf = (fn: () => unknown): object => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationException);
      return (e as ValidationException).getResponse() as object;
    }
    throw new Error('expected a ValidationException');
  };
  const ADULT: AgeRestrictionColumns = {
    isAgeRestricted: true,
    minAgeValue: 18,
    minAgeUnit: AgeUnit.YEARS,
    maxAgeValue: 60,
    maxAgeUnit: AgeUnit.YEARS,
  };

  describe('create (no stored row)', () => {
    it('defaults to no restriction when the body omits it', () => {
      expect(resolveAgeRestriction({})).toEqual(NONE);
    });

    it('keeps a valid enabled range', () => {
      expect(resolveAgeRestriction(ADULT)).toEqual(ADULT);
    });

    it('accepts mixed units and a same-value range', () => {
      expect(
        resolveAgeRestriction({
          isAgeRestricted: true,
          minAgeValue: 1,
          minAgeUnit: AgeUnit.DAYS,
          maxAgeValue: 18,
          maxAgeUnit: AgeUnit.MONTHS,
        }),
      ).toMatchObject({ isAgeRestricted: true, minAgeValue: 1 });
      expect(
        resolveAgeRestriction({
          ...ADULT,
          minAgeValue: 18,
          maxAgeValue: 18,
        }),
      ).toMatchObject({ minAgeValue: 18, maxAgeValue: 18 });
    });

    it('clears every bound when disabled', () => {
      expect(
        resolveAgeRestriction({ ...ADULT, isAgeRestricted: false }),
      ).toEqual(NONE);
    });

    it('rejects an enabled restriction with a missing bound', () => {
      expect(() =>
        resolveAgeRestriction({ ...ADULT, maxAgeValue: null }),
      ).toThrow(ValidationException);
      expect(
        messageOf(() => resolveAgeRestriction({ isAgeRestricted: true })),
      ).toMatchObject({
        error: {
          message:
            'Minimum Age and Maximum Age are required when Age Restriction is Yes',
        },
      });
    });

    it('rejects min > max on the calendar (25 Months > 1 Year)', () => {
      expect(
        messageOf(() => resolveAgeRestriction({ ...ADULT, minAgeValue: 61 })),
      ).toMatchObject({
        error: { message: 'Minimum Age must not be greater than Maximum Age' },
      });
      expect(() =>
        resolveAgeRestriction({
          isAgeRestricted: true,
          minAgeValue: 25,
          minAgeUnit: AgeUnit.MONTHS,
          maxAgeValue: 1,
          maxAgeUnit: AgeUnit.YEARS,
        }),
      ).toThrow(ValidationException);
    });
  });

  describe('update (merged with the stored row)', () => {
    it('leaves the columns untouched when the body sends none of them', () => {
      expect(resolveAgeRestriction({}, ADULT)).toBeUndefined();
    });

    it('merges a partial patch with the stored bounds', () => {
      expect(resolveAgeRestriction({ maxAgeValue: 65 }, ADULT)).toEqual({
        ...ADULT,
        maxAgeValue: 65,
      });
    });

    it('enabling without bounds on a row that has none is rejected', () => {
      expect(() =>
        resolveAgeRestriction({ isAgeRestricted: true }, NONE),
      ).toThrow(ValidationException);
    });

    it('disabling clears the stored bounds', () => {
      expect(resolveAgeRestriction({ isAgeRestricted: false }, ADULT)).toEqual(
        NONE,
      );
    });

    it('a partial patch that breaks min ≤ max is rejected', () => {
      expect(() => resolveAgeRestriction({ minAgeValue: 70 }, ADULT)).toThrow(
        ValidationException,
      );
    });
  });
});
