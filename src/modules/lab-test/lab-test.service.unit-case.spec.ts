import { AgeUnit, ReferenceGender } from '@prisma/client';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from './lab-test.service';

/**
 * Units are compared ignoring letter case and surrounding spaces ("g/dL" = "g/dl") wherever a
 * reference range's unit decides the group: the overlap check's analyzer partitions and the
 * Default group. The method is NOT normalised (it stays exact).
 */
describe('LabTestService — a unit differing only in letter case or spaces is the same unit', () => {
  const service = new LabTestService(
    {} as unknown as PrismaService,
    {} as unknown as MasterDataService,
  );
  const priv = service as unknown as {
    assertParam: (p: unknown) => void;
    assertAdapterDefaultsPresent: (r: unknown[], code: string) => void;
  };
  const Y = AgeUnit.YEARS;
  const range = (o: Record<string, unknown>) => ({
    gender: ReferenceGender.ALL,
    ageFrom: 0,
    ageFromUnit: Y,
    ageTo: 999,
    ageToUnit: Y,
    lowerLimit: 12,
    upperLimit: 16,
    isDefault: false,
    ...o,
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
  const save = (ranges: unknown[]) =>
    run(() =>
      priv.assertParam({ parameterCode: 'HGB', referenceRanges: ranges }),
    );
  const defaultsOnly = (ranges: unknown[]) =>
    run(() => priv.assertAdapterDefaultsPresent(ranges, 'HGB'));

  const a = (unit: string, extra: Record<string, unknown> = {}) =>
    range({ labAdapterId: 'cobas', method: 'SLS', unit, ...extra });

  describe('overlap check (same analyzer, method, gender and age band)', () => {
    it.each([
      ['g/dL', 'g/dl'],
      ['mg/dL', 'MG/DL'],
      ['uIU/mL', 'uIu/mL'],
      ['g/dL', ' g/dL '],
      ['g/dL', 'g/dL'],
    ])(
      '"%s" and "%s" are one unit: the second range is a duplicate',
      (u1, u2) => {
        expect(save([a(u1, { isDefault: true }), a(u2)])).toMatch(
          /A similar reference range already exists/,
        );
      },
    );

    it.each([
      ['g/dL', 'g/L'],
      ['mg/dL', 'mmol/L'],
      ['g/dL', ''],
    ])('"%s" and "%s" are different units: accepted', (u1, u2) => {
      expect(
        save([a(u1, { isDefault: true }), a(u2, { isDefault: true })]),
      ).toBe('ACCEPTED');
    });

    it('a different analyzer with the same unit in another case is still a separate group', () => {
      expect(
        save([
          a('g/dL', { isDefault: true }),
          a('g/dl', { labAdapterId: 'sysmex', isDefault: true }),
        ]),
      ).toBe('ACCEPTED');
    });

    it('the method is still compared exactly by the overlap check (only the unit ignores case)', () => {
      // "SLS" and "sls" are two methods to the overlap check, so the two ranges are not duplicates;
      // they are one Default group (the method is not in that key), so exactly one is the Default.
      expect(
        save([
          a('g/dL', { method: 'SLS', isDefault: true }),
          a('g/dL', { method: 'sls' }),
        ]),
      ).toBe('ACCEPTED');
    });
  });

  describe('Default group', () => {
    it('two ranges whose units differ only by case are one group: one Default is required', () => {
      expect(defaultsOnly([a('g/dL'), a('g/dl')])).toMatch(/Mark a Default/);
    });

    it('two Defaults in that group are refused', () => {
      expect(
        defaultsOnly([
          a('g/dL', { isDefault: true }),
          a('G/DL', { isDefault: true }),
        ]),
      ).toMatch(/Only one range can be Default/);
    });

    it('exactly one Default in that group is accepted', () => {
      expect(defaultsOnly([a('g/dL', { isDefault: true }), a('g/dl')])).toBe(
        'ACCEPTED',
      );
    });

    it('different units stay separate groups: a lone range needs no Default', () => {
      expect(defaultsOnly([a('g/dL'), a('g/L')])).toBe('ACCEPTED');
    });
  });
});
