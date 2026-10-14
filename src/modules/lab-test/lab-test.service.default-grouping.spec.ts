import { AgeUnit, ReferenceGender } from '@prisma/client';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from './lab-test.service';

/**
 * The "one Default per group" rule for reference ranges. The group key is
 * (parameter, analyzer, UNIT, gender, age band). The METHOD is not part of it:
 * an analyzer sends a value and its unit but never the method, so the analyzer
 * plus the unit it sent decides which ranges apply, and the Default breaks the
 * tie between several methods in that unit. A group of two or more needs exactly
 * one Default; a lone range needs none (it is chosen as the only candidate).
 */
describe('LabTestService — one Default per analyzer + unit + gender + age band (method not in the key)', () => {
  const service = new LabTestService(
    {} as unknown as PrismaService,
    {} as unknown as MasterDataService,
  );
  const priv = service as unknown as {
    assertParam: (p: unknown) => void;
    assertNoRangeOverlap: (r: unknown[], code: string) => void;
    assertAdapterDefaultsPresent: (r: unknown[], code: string) => void;
  };
  const Y = AgeUnit.YEARS;

  type R = {
    labAdapterId?: string;
    method?: string;
    unit?: string;
    gender?: ReferenceGender;
    ageFrom?: number;
    ageTo?: number;
    isDefault?: boolean;
  };
  const range = (o: R) => ({
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
  const viaAssertParam = (ranges: unknown[]) =>
    run(() =>
      priv.assertParam({ parameterCode: 'HGB', referenceRanges: ranges }),
    );
  const viaDefaultsOnly = (ranges: unknown[]) =>
    run(() => priv.assertAdapterDefaultsPresent(ranges, 'HGB'));

  const cobas = { labAdapterId: 'cobas', unit: 'g/dL' };

  describe('the group key (assertAdapterDefaultsPresent on its own)', () => {
    it('two ranges of the same analyzer, unit, gender and age with no Default are rejected', () => {
      expect(viaDefaultsOnly([range(cobas), range(cobas)])).toMatch(
        /Mark a Default range .*analyzer \+ unit/,
      );
    });

    it('two Defaults in one group are rejected', () => {
      expect(
        viaDefaultsOnly([
          range({ ...cobas, isDefault: true }),
          range({ ...cobas, isDefault: true }),
        ]),
      ).toMatch(
        /Only one range can be Default per analyzer\/unit\/gender\/age/,
      );
    });

    it('exactly one Default in a group of two is accepted', () => {
      expect(
        viaDefaultsOnly([range({ ...cobas, isDefault: true }), range(cobas)]),
      ).toBe('ACCEPTED');
    });

    it('a different METHOD is the SAME group: two methods in one unit need exactly one Default', () => {
      const m = (method: string, isDefault?: boolean) =>
        range({ ...cobas, method, isDefault });
      expect(viaDefaultsOnly([m('SLS'), m('Cyan')])).toMatch(
        /Mark a Default range/,
      );
      expect(viaDefaultsOnly([m('SLS', true), m('Cyan', true)])).toMatch(
        /Only one range can be Default/,
      );
      expect(viaDefaultsOnly([m('SLS', true), m('Cyan')])).toBe('ACCEPTED');
    });

    it('a different UNIT is a separate group: a lone range in each needs no Default', () => {
      expect(
        viaDefaultsOnly([
          range({ ...cobas, unit: 'g/dL' }),
          range({ ...cobas, unit: 'g/L' }),
        ]),
      ).toBe('ACCEPTED');
    });

    it('each unit group has its own Default', () => {
      const u = (unit: string, method: string, isDefault?: boolean) =>
        range({ labAdapterId: 'cobas', unit, method, isDefault });
      expect(
        viaDefaultsOnly([
          u('g/dL', 'SLS', true),
          u('g/dL', 'Cyan'),
          u('g/L', 'SLS', true),
          u('g/L', 'Cyan'),
        ]),
      ).toBe('ACCEPTED');
      // the g/L group has two ranges and no Default
      expect(
        viaDefaultsOnly([
          u('g/dL', 'SLS', true),
          u('g/dL', 'Cyan'),
          u('g/L', 'SLS'),
          u('g/L', 'Cyan'),
        ]),
      ).toMatch(/Mark a Default range/);
    });

    it('the unit ignores letter case and spaces', () => {
      expect(
        viaDefaultsOnly([
          range({ ...cobas, unit: 'g/dL', isDefault: true }),
          range({ ...cobas, unit: ' G/DL ' }),
        ]),
      ).toBe('ACCEPTED');
      expect(
        viaDefaultsOnly([
          range({ ...cobas, unit: 'g/dL', isDefault: true }),
          range({ ...cobas, unit: 'g/dl', isDefault: true }),
        ]),
      ).toMatch(/Only one range can be Default/);
    });

    it('a different analyzer / gender / age band is still a separate group', () => {
      const base = { unit: 'g/dL', isDefault: true };
      expect(
        viaDefaultsOnly([
          range({ ...base, labAdapterId: 'cobas' }),
          range({ ...base, labAdapterId: 'sysmex' }),
          range({
            ...base,
            labAdapterId: 'cobas',
            gender: ReferenceGender.MALE,
          }),
          range({ ...base, labAdapterId: 'cobas', ageTo: 17 }),
        ]),
      ).toBe('ACCEPTED');
    });

    it('a missing unit equals an empty one (same group)', () => {
      expect(
        viaDefaultsOnly([
          range({ labAdapterId: 'cobas', isDefault: true }),
          range({ labAdapterId: 'cobas', unit: '', isDefault: true }),
        ]),
      ).toMatch(/Only one range can be Default/);
    });

    it('ranges without an analyzer are grouped by unit too (method ignored)', () => {
      expect(
        viaDefaultsOnly([
          range({ method: 'M1', unit: 'g/dL', isDefault: true }),
          range({ method: 'M2', unit: 'g/dL', isDefault: true }),
        ]),
      ).toMatch(/Only one range can be Default/);
      expect(
        viaDefaultsOnly([
          range({ method: 'M1', unit: 'g/dL', isDefault: true }),
          range({ method: 'M2', unit: 'g/L', isDefault: true }),
        ]),
      ).toBe('ACCEPTED');
    });
  });

  describe('through assertParam, as a real save: the rule now fires', () => {
    it('one analyzer, two METHODS in the same unit and age band, no Default: rejected', () => {
      expect(
        viaAssertParam([
          range({ ...cobas, method: 'SLS' }),
          range({ ...cobas, method: 'Cyan' }),
        ]),
      ).toMatch(/Mark a Default range/);
    });

    it('... both marked Default: rejected', () => {
      expect(
        viaAssertParam([
          range({ ...cobas, method: 'SLS', isDefault: true }),
          range({ ...cobas, method: 'Cyan', isDefault: true }),
        ]),
      ).toMatch(/Only one range can be Default/);
    });

    it('... exactly one Default: accepted', () => {
      expect(
        viaAssertParam([
          range({ ...cobas, method: 'SLS', isDefault: true }),
          range({ ...cobas, method: 'Cyan' }),
        ]),
      ).toBe('ACCEPTED');
    });

    it('one analyzer, two UNITS, one range each and no Default: accepted (each is the only candidate)', () => {
      expect(
        viaAssertParam([
          range({ labAdapterId: 'cobas', method: 'M1', unit: 'g/dL' }),
          range({ labAdapterId: 'cobas', method: 'M2', unit: 'g/L' }),
        ]),
      ).toBe('ACCEPTED');
    });

    it('exact duplicates (same analyzer/method/unit/gender/age) are still rejected, by the overlap check first', () => {
      const a = { ...cobas, method: 'SLS', isDefault: true };
      expect(viaAssertParam([range(a), range(a)])).toMatch(
        /similar reference range already exists/,
      );
    });

    it('analyzer-less ranges for different methods but the same gender/age are still rejected as similar', () => {
      expect(
        viaAssertParam([
          range({ method: 'M1', isDefault: true }),
          range({ method: 'M2', isDefault: true }),
        ]),
      ).toMatch(/similar reference range already exists/);
    });

    it('"SLS" and "SLS " are different methods to the overlap check but the same Default group', () => {
      expect(
        viaAssertParam([
          range({ ...cobas, method: 'SLS' }),
          range({ ...cobas, method: 'SLS ' }),
        ]),
      ).toMatch(/Mark a Default range/);
    });
  });

  describe('matches an independent description of the rule (randomised check)', () => {
    /** The rule restated simply: group by analyzer + normalised unit + gender + band. */
    const expectedOk = (ranges: ReturnType<typeof range>[]): boolean => {
      const groups = new Map<string, ReturnType<typeof range>[]>();
      for (const r of ranges) {
        const key = `${r.labAdapterId ?? ''}|${(r.unit ?? '').trim().toLowerCase()}|${r.gender}|${r.ageFrom}|${r.ageTo}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      return [...groups.values()].every((g) => {
        const defaults = g.filter((r) => r.isDefault).length;
        return defaults <= 1 && !(g.length > 1 && defaults === 0);
      });
    };

    // Small deterministic PRNG so a failure is reproducible.
    let seed = 20261012;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;

    it('over 4000 random range sets the check accepts exactly what the rule allows', () => {
      let accepted = 0;
      for (let i = 0; i < 4000; i++) {
        const n = 1 + Math.floor(rand() * 5);
        const ranges = Array.from({ length: n }, () =>
          range({
            labAdapterId: pick([undefined, 'cobas', 'sysmex']),
            method: pick([undefined, 'SLS', 'Cyan', 'sls']),
            unit: pick([undefined, 'g/dL', 'G/DL', ' g/L ', 'g/l']),
            gender: pick([ReferenceGender.ALL, ReferenceGender.MALE]),
            ageTo: pick([17, 999]),
            isDefault: rand() < 0.4,
          }),
        );
        const ok = expectedOk(ranges);
        if (ok) accepted++;
        expect(viaDefaultsOnly(ranges) === 'ACCEPTED').toBe(ok);
      }
      // the sample really exercises both outcomes (most random sets are valid, a few hundred are not)
      expect(accepted).toBeGreaterThan(400);
      expect(4000 - accepted).toBeGreaterThan(100);
    });
  });
});
