import { AgeUnit } from '@prisma/client';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from './lab-test.service';

/**
 * Age From / Age To validation on reference ranges and reference values. The two
 * bounds carry their own unit, so they must be compared on the calendar and not
 * as raw numbers (the old check compared 15 with 1 for "15 Days to 1 Year" and
 * rejected a valid range).
 */
describe('LabTestService age-bound validation', () => {
  let service: LabTestService;
  // The validators are private; exercised through the same entry points the
  // create / update / import flows use.
  let assertParam: (p: unknown) => void;
  let assertImportParam: (p: unknown) => void;

  const D = AgeUnit.DAYS;
  const M = AgeUnit.MONTHS;
  const Y = AgeUnit.YEARS;

  const range = (
    ageFrom: number,
    ageFromUnit: AgeUnit,
    ageTo: number,
    ageToUnit: AgeUnit,
  ) => ({ ageFrom, ageFromUnit, ageTo, ageToUnit, isDefault: true });

  const param = (
    referenceRanges: unknown[] = [],
    referenceValues: unknown[] = [],
  ) => ({ parameterCode: 'P1', referenceRanges, referenceValues });

  /** The user-facing message of the ValidationException an entry point throws. */
  const messageOf = (fn: () => void): string => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationException);
      const body = (e as ValidationException).getResponse() as {
        error: { message: string };
      };
      return body.error.message;
    }
    throw new Error('expected a ValidationException, but nothing was thrown');
  };

  beforeEach(() => {
    service = new LabTestService(
      {} as unknown as PrismaService,
      {} as unknown as MasterDataService,
    );
    const s = service as unknown as {
      assertParam: (p: unknown) => void;
      assertImportParam: (p: unknown) => void;
    };
    assertParam = s.assertParam.bind(service);
    assertImportParam = s.assertImportParam.bind(service);
  });

  describe.each([
    ['assertParam (create / update)', () => assertParam],
    ['assertImportParam (Excel import)', () => assertImportParam],
  ])('%s', (_name, entry) => {
    it('accepts 15 Days to 1 Year on a reference range (the reported bug)', () => {
      expect(() => entry()(param([range(15, D, 1, Y)]))).not.toThrow();
    });

    it('accepts 15 Days to 1 Year on a reference value', () => {
      expect(() => entry()(param([], [range(15, D, 1, Y)]))).not.toThrow();
    });

    it('accepts 1 Year to 12 Months and 30 Days to 1 Month', () => {
      expect(() => entry()(param([range(1, Y, 12, M)]))).not.toThrow();
      expect(() => entry()(param([range(30, D, 1, M)]))).not.toThrow();
    });

    it('rejects 1 Year to 11 Months on a reference range, naming both bounds', () => {
      expect(() => entry()(param([range(1, Y, 11, M)]))).toThrow(
        ValidationException,
      );
      expect(messageOf(() => entry()(param([range(1, Y, 11, M)])))).toMatch(
        /Age From \(1 Year\) cannot be later than Age To \(11 Months\)/,
      );
    });

    it('rejects a reversed reference VALUE (previously only the DB constraint caught it)', () => {
      expect(() => entry()(param([], [range(1, Y, 11, M)]))).toThrow(
        ValidationException,
      );
    });

    it('rejects a reversed range in the same unit', () => {
      expect(messageOf(() => entry()(param([range(5, Y, 1, Y)])))).toMatch(
        /Age From \(5 Years\) cannot be later than Age To \(1 Year\)/,
      );
    });

    it('rejects 1 Month to 30 Days, which is empty for some birth dates', () => {
      expect(() => entry()(param([range(1, M, 30, D)]))).toThrow(
        ValidationException,
      );
    });

    it('uses the database defaults (0 Years to 999 Years) when ages are omitted', () => {
      expect(() =>
        entry()(
          param([{ isDefault: true }], [{ normalValueText: 'Negative' }]),
        ),
      ).not.toThrow();
    });

    it('treats an omitted Age To as 999 Years, so any Age From within that passes', () => {
      expect(() =>
        entry()(param([{ ageFrom: 40, ageFromUnit: Y, isDefault: true }])),
      ).not.toThrow();
    });
  });
});
