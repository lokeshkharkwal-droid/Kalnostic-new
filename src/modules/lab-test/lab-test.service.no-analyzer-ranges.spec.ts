import { AgeUnit, ReferenceGender } from '@prisma/client';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from './lab-test.service';

/**
 * Adding a reference range WITHOUT an analyzer. Like a range with an analyzer, two ranges only conflict when they share the exact same
 * (analyzer — here none —, method, unit) AND their Gender/Age overlaps:
 *   1. only the METHOD is different, everything else the same  -> allowed;
 *   2. only the UNIT is different, everything else the same    -> allowed;
 * while the same method + unit + gender + age band is still "a similar range", a partial Gender/Age overlap is still "overlapping",
 * and a range without an analyzer never meets a range that has one.
 */
describe('LabTestService — reference ranges without an analyzer: method and unit tell ranges apart', () => {
  const service = new LabTestService(
    {} as unknown as PrismaService,
    {} as unknown as MasterDataService,
  );
  const priv = service as unknown as {
    assertParam: (p: unknown) => void;
    assertNoRangeOverlap: (r: unknown[], code: string) => void;
  };
  const Y = AgeUnit.YEARS;

  type R = {
    labAdapterId?: string;
    method?: string;
    unit?: string;
    gender?: ReferenceGender;
    ageFrom?: number;
    ageTo?: number;
    lowerLimit?: number;
    upperLimit?: number;
    isDefault?: boolean;
  };
  const range = (o: R = {}) => ({
    gender: ReferenceGender.ALL,
    ageFrom: 0,
    ageFromUnit: Y,
    ageTo: 999,
    ageToUnit: Y,
    lowerLimit: 12,
    upperLimit: 16,
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
  const overlap = (ranges: unknown[]) =>
    run(() => priv.assertNoRangeOverlap(ranges, 'HGB'));
  const save = (ranges: unknown[]) =>
    run(() =>
      priv.assertParam({ parameterCode: 'HGB', referenceRanges: ranges }),
    );

  const SIMILAR = /similar reference range already exists/;
  const OVERLAPPING = /Overlapping reference range/;

  describe('point 1: only the method is different', () => {
    it('is allowed', () => {
      expect(
        overlap([
          range({ method: 'SLS' }),
          range({ method: 'Cyanmethemoglobin' }),
        ]),
      ).toBe('ACCEPTED');
    });
    it('is allowed through a real save as well (the Default rule does not stop it: each method is its own group)', () => {
      expect(
        save([
          range({ method: 'SLS' }),
          range({ method: 'Cyanmethemoglobin' }),
        ]),
      ).toBe('ACCEPTED');
    });
    it('with a unit on both', () => {
      expect(
        overlap([
          range({ method: 'SLS', unit: 'g/dL' }),
          range({ method: 'Cyan', unit: 'g/dL' }),
        ]),
      ).toBe('ACCEPTED');
    });
    it('a range with a method next to one with no method at all', () => {
      expect(overlap([range({ method: 'SLS' }), range()])).toBe('ACCEPTED');
      expect(overlap([range({ method: 'SLS' }), range({ method: '' })])).toBe(
        'ACCEPTED',
      );
    });
    it('many methods at once', () => {
      const methods = ['A', 'B', 'C', 'D', 'E', 'F'];
      expect(overlap(methods.map((method) => range({ method })))).toBe(
        'ACCEPTED',
      );
    });
    it('the method is compared exactly: letter case counts', () => {
      expect(
        overlap([range({ method: 'SLS' }), range({ method: 'sls' })]),
      ).toBe('ACCEPTED');
    });
  });

  describe('point 2: only the unit is different', () => {
    it('is allowed', () => {
      expect(overlap([range({ unit: 'g/dL' }), range({ unit: 'g/L' })])).toBe(
        'ACCEPTED',
      );
    });
    it('is allowed through a real save as well', () => {
      expect(save([range({ unit: 'g/dL' }), range({ unit: 'g/L' })])).toBe(
        'ACCEPTED',
      );
    });
    it('with the same method on both', () => {
      expect(
        overlap([
          range({ method: 'SLS', unit: 'g/dL' }),
          range({ method: 'SLS', unit: 'g/L' }),
        ]),
      ).toBe('ACCEPTED');
    });
    it('a range with a unit next to one with no unit', () => {
      expect(overlap([range({ unit: 'g/dL' }), range()])).toBe('ACCEPTED');
    });
    it('many units at once', () => {
      const units = ['g/dL', 'g/L', 'mg/dL', 'mmol/L', '%'];
      expect(overlap(units.map((unit) => range({ unit })))).toBe('ACCEPTED');
    });
  });

  describe('method AND unit different, any gender / age', () => {
    it('is allowed even for the same gender and age band', () => {
      expect(
        overlap([
          range({ method: 'A', unit: 'g/dL' }),
          range({ method: 'B', unit: 'g/L' }),
        ]),
      ).toBe('ACCEPTED');
    });
    it('is allowed for overlapping ages of different genders', () => {
      expect(
        overlap([
          range({ method: 'A', gender: ReferenceGender.MALE }),
          range({
            method: 'B',
            gender: ReferenceGender.ALL,
            ageFrom: 5,
            ageTo: 20,
          }),
        ]),
      ).toBe('ACCEPTED');
    });
  });

  describe('what is still refused (unchanged)', () => {
    it('the same method, unit, gender and age band is "a similar range"', () => {
      expect(
        overlap([
          range({ method: 'SLS', unit: 'g/dL' }),
          range({ method: 'SLS', unit: 'g/dL' }),
        ]),
      ).toMatch(SIMILAR);
    });
    it('two ranges with no method and no unit at all, same gender and band, are "similar"', () => {
      expect(overlap([range(), range()])).toMatch(SIMILAR);
    });
    it('the unit ignores letter case and spaces: "g/dL" and " G/DL " are the same unit', () => {
      expect(
        overlap([range({ unit: 'g/dL' }), range({ unit: ' G/DL ' })]),
      ).toMatch(SIMILAR);
    });
    it('the same method and unit with a PARTLY overlapping age is "overlapping"', () => {
      expect(
        overlap([
          range({ method: 'SLS', unit: 'g/dL', ageFrom: 0, ageTo: 10 }),
          range({ method: 'SLS', unit: 'g/dL', ageFrom: 5, ageTo: 15 }),
        ]),
      ).toMatch(OVERLAPPING);
    });
    it('the same method and unit, All against Male for the same ages, is "overlapping"', () => {
      expect(
        overlap([
          range({ method: 'SLS', unit: 'g/dL', gender: ReferenceGender.ALL }),
          range({ method: 'SLS', unit: 'g/dL', gender: ReferenceGender.MALE }),
        ]),
      ).toMatch(OVERLAPPING);
    });
    it('the same method and unit with separate ages is fine (0-17, 18-100)', () => {
      expect(
        overlap([
          range({ method: 'SLS', unit: 'g/dL', ageFrom: 0, ageTo: 17 }),
          range({ method: 'SLS', unit: 'g/dL', ageFrom: 18, ageTo: 100 }),
        ]),
      ).toBe('ACCEPTED');
    });
    it('the same method and unit, Male and Female for the same ages, is fine', () => {
      expect(
        overlap([
          range({ method: 'SLS', unit: 'g/dL', gender: ReferenceGender.MALE }),
          range({
            method: 'SLS',
            unit: 'g/dL',
            gender: ReferenceGender.FEMALE,
          }),
        ]),
      ).toBe('ACCEPTED');
    });
    it('a refused pair is refused wherever it sits in a longer list', () => {
      const ranges = [
        range({ method: 'A' }),
        range({ method: 'B' }),
        range({ method: 'C', unit: 'g/L' }),
        range({ method: 'B' }),
      ];
      expect(overlap(ranges)).toMatch(SIMILAR);
    });
  });

  describe('ranges with an analyzer are unchanged', () => {
    const cobas = { labAdapterId: 'cobas', unit: 'g/dL' };
    it('the same analyzer, method, unit, gender and band is still "similar"', () => {
      expect(
        overlap([
          range({ ...cobas, method: 'SLS' }),
          range({ ...cobas, method: 'SLS' }),
        ]),
      ).toMatch(SIMILAR);
    });
    it('the same analyzer with a different method, or a different unit, is still allowed', () => {
      expect(
        overlap([
          range({ ...cobas, method: 'SLS' }),
          range({ ...cobas, method: 'Cyan' }),
        ]),
      ).toBe('ACCEPTED');
      expect(
        overlap([
          range({ ...cobas, method: 'SLS' }),
          range({ ...cobas, method: 'SLS', unit: 'g/L' }),
        ]),
      ).toBe('ACCEPTED');
    });
    it('another analyzer is a separate group', () => {
      expect(
        overlap([
          range({ labAdapterId: 'cobas', method: 'SLS' }),
          range({ labAdapterId: 'sysmex', method: 'SLS' }),
        ]),
      ).toBe('ACCEPTED');
    });
  });

  describe('a range without an analyzer never meets a range that has one', () => {
    it('same method, unit, gender and band: no conflict between the two', () => {
      expect(
        overlap([
          range({ method: 'SLS', unit: 'g/dL' }),
          range({ labAdapterId: 'cobas', method: 'SLS', unit: 'g/dL' }),
        ]),
      ).toBe('ACCEPTED');
    });
    it('and an empty-string analyzer id counts as "no analyzer"', () => {
      expect(
        overlap([
          range({ labAdapterId: '', method: 'SLS' }),
          range({ method: 'SLS' }),
        ]),
      ).toMatch(SIMILAR);
    });
  });

  describe('matches an independent description of the rule (randomised check)', () => {
    /** Tiny seeded generator, so a failure can be replayed. */
    const rng = (seed: number) => {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const METHODS: Array<string | undefined> = [
      undefined,
      '',
      'SLS',
      'Cyan',
      'sls',
    ];
    const UNITS: Array<string | undefined> = [
      undefined,
      '',
      'g/dL',
      'G/DL',
      ' g/dl ',
      'g/L',
    ];
    const GENDERS = [
      ReferenceGender.ALL,
      ReferenceGender.MALE,
      ReferenceGender.FEMALE,
    ];
    const ANALYZERS: Array<string | undefined> = [
      undefined,
      undefined,
      'cobas',
      'sysmex',
    ];

    /** The rule restated simply, with whole-year bands: every kind of conflict found among the pairs (which one is reported first depends on the group order). */
    const expected = (
      rs: ReturnType<typeof range>[],
    ): Set<'similar' | 'overlap'> => {
      const found = new Set<'similar' | 'overlap'>();
      const norm = (u?: string) =>
        (u ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
      for (let i = 0; i < rs.length; i++) {
        for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i]!;
          const b = rs[j]!;
          if ((a.labAdapterId ?? '') !== (b.labAdapterId ?? '')) continue;
          if ((a.method ?? '') !== (b.method ?? '')) continue;
          if (norm(a.unit) !== norm(b.unit)) continue;
          const gendersMeet =
            a.gender === ReferenceGender.ALL ||
            b.gender === ReferenceGender.ALL ||
            a.gender === b.gender;
          if (!gendersMeet) continue;
          if (!(a.ageFrom <= b.ageTo && b.ageFrom <= a.ageTo)) continue;
          found.add(
            a.gender === b.gender &&
              a.ageFrom === b.ageFrom &&
              a.ageTo === b.ageTo
              ? 'similar'
              : 'overlap',
          );
        }
      }
      return found;
    };

    it.each([1, 2, 3, 4, 5, 6])(
      'seed %i: 400 random lists of 2-6 ranges give the same verdict as the plain description',
      (seed) => {
        const rand = rng(seed * 7919);
        const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
        for (let n = 0; n < 400; n++) {
          const count = 2 + Math.floor(rand() * 5);
          const rs = Array.from({ length: count }, () => {
            const from = Math.floor(rand() * 40);
            return range({
              labAdapterId: pick(ANALYZERS),
              method: pick(METHODS),
              unit: pick(UNITS),
              gender: pick(GENDERS),
              ageFrom: from,
              ageTo: from + Math.floor(rand() * 40),
            });
          });
          const want = expected(rs);
          const got = overlap(rs);
          const ctx = JSON.stringify(
            rs.map((r) => [
              r.labAdapterId,
              r.method,
              r.unit,
              r.gender,
              r.ageFrom,
              r.ageTo,
            ]),
          );
          const kind =
            got === 'ACCEPTED'
              ? 'ok'
              : SIMILAR.test(got)
                ? 'similar'
                : OVERLAPPING.test(got)
                  ? 'overlap'
                  : got;
          const fine =
            want.size === 0
              ? kind === 'ok'
              : want.has(kind as 'similar' | 'overlap');
          if (!fine)
            throw new Error(
              `seed ${seed}: got "${kind}", expected ${want.size === 0 ? 'ok' : [...want].join(' or ')} for ${ctx}`,
            );
        }
      },
    );
  });
});
