import { AgeType, AgeUnit } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import {
  candidateAgeMatch,
  candidateAgeRank,
  coversAllAges,
  isExactAgeMatch,
  rangeAgeMatch,
  sortRangesByAgeSpecificity,
} from './utils/reference-range.util';

const D = AgeUnit.DAYS;
const M = AgeUnit.MONTHS;
const Y = AgeUnit.YEARS;

describe('sortRangesByAgeSpecificity', () => {
  const row = (
    id: string,
    ageFrom: number,
    ageFromUnit: AgeUnit,
    ageTo: number,
    ageToUnit: AgeUnit,
  ) => ({ id, ageFrom, ageFromUnit, ageTo, ageToUnit });
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it('puts the range that starts later first', () => {
    const sorted = sortRangesByAgeSpecificity([
      row('days', 0, D, 30, D),
      row('months', 1, M, 11, M),
      row('adult', 18, Y, 60, Y),
    ]);
    expect(ids(sorted)).toEqual(['adult', 'months', 'days']);
  });

  it('the result does not depend on the incoming order', () => {
    const rows = [
      row('a', 0, D, 30, D),
      row('b', 1, M, 11, M),
      row('c', 1, Y, 5, Y),
    ];
    const forward = ids(sortRangesByAgeSpecificity(rows));
    const reversed = ids(sortRangesByAgeSpecificity([...rows].reverse()));
    expect(reversed).toEqual(forward);
  });

  it('on the same start, the narrower range (lower Age To) comes first', () => {
    const sorted = sortRangesByAgeSpecificity([
      row('wide', 0, Y, 999, Y),
      row('narrow', 0, Y, 17, Y),
    ]);
    expect(ids(sorted)).toEqual(['narrow', 'wide']);
  });

  it('keeps the incoming order for ranges that tie on both (stable)', () => {
    const sorted = sortRangesByAgeSpecificity([
      row('first', 0, Y, 999, Y),
      row('second', 0, Y, 999, Y),
    ]);
    expect(ids(sorted)).toEqual(['first', 'second']);
  });

  it('does not modify the input array', () => {
    const rows = [row('days', 0, D, 30, D), row('months', 1, M, 11, M)];
    sortRangesByAgeSpecificity(rows);
    expect(ids(rows)).toEqual(['days', 'months']);
  });
});

describe('rangeAgeMatch (a patient age against a reference row, on the calendar)', () => {
  const band = (
    ageFrom: number,
    ageFromUnit: AgeUnit,
    ageTo: number,
    ageToUnit: AgeUnit,
  ) => ({ ageFrom, ageFromUnit, ageTo, ageToUnit });

  it('is unknown only when the age is missing; 0 is a real age', () => {
    expect(
      rangeAgeMatch({ age: null, ageType: AgeType.YEARS }, band(0, Y, 999, Y)),
    ).toBe('unknown');
    expect(
      rangeAgeMatch(
        { age: undefined, ageType: AgeType.YEARS },
        band(0, Y, 999, Y),
      ),
    ).toBe('unknown');
    expect(
      rangeAgeMatch({ age: 0, ageType: AgeType.DAYS }, band(0, D, 28, D)),
    ).toBe('match');
    expect(
      rangeAgeMatch({ age: 0, ageType: AgeType.DAYS }, band(18, Y, 60, Y)),
    ).toBe('none');
  });

  it('an unset unit means years', () => {
    expect(rangeAgeMatch({ age: 34, ageType: null }, band(18, Y, 60, Y))).toBe(
      'match',
    );
  });

  it('12 Months is exactly 1 Year: it fits "1 Year-5 Years" and not "1-11 Months"', () => {
    const p = { age: 12, ageType: AgeType.MONTHS };
    expect(rangeAgeMatch(p, band(1, Y, 5, Y))).toBe('match');
    expect(rangeAgeMatch(p, band(1, M, 11, M))).toBe('none');
  });

  it('a stored "1 Year" cannot say which month, so it is only a partial fit for month bands', () => {
    const p = { age: 1, ageType: AgeType.YEARS };
    expect(rangeAgeMatch(p, band(0, M, 17, M))).toBe('partial');
    expect(rangeAgeMatch(p, band(18, M, 23, M))).toBe('partial');
    expect(rangeAgeMatch(p, band(12, M, 23, M))).toBe('match');
  });

  it('isExactAgeMatch accepts match and unknown, never partial or none', () => {
    expect(isExactAgeMatch('match')).toBe(true);
    expect(isExactAgeMatch('unknown')).toBe(true);
    expect(isExactAgeMatch('partial')).toBe(false);
    expect(isExactAgeMatch('none')).toBe(false);
  });
});

describe('LabReportService — which reference range the technician side offers', () => {
  const rangeRow = (
    id: string,
    ageFrom: number,
    ageFromUnit: AgeUnit,
    ageTo: number,
    ageToUnit: AgeUnit,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    labAdapterId: null,
    method: null,
    unit: 'g/dL',
    isDefault: true,
    gender: 'ALL',
    ageFrom,
    ageFromUnit,
    ageTo,
    ageToUnit,
    lowerLimit: { toString: () => '12' },
    upperLimit: { toString: () => '16' },
    displayOfReferenceRange: id,
    ...extra,
  });

  type Patient = { age: number | null; ageType: AgeType };

  const build = (rows: unknown[], patient: Patient) => {
    const prisma = {
      labReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rep',
          labTestId: 'lt',
          orderItem: {
            order: { patient: { ...patient, gender: 'MALE' } },
          },
        }),
      },
      labTestResultParam: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'p1', resultType: 'QUANTITATIVE' }),
      },
      labTestReferenceRange: { findMany: jest.fn().mockResolvedValue(rows) },
      labAdapter: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = Object.create(LabReportService.prototype) as unknown as {
      prisma: unknown;
      listReferenceRangeCandidates: (...a: unknown[]) => Promise<{
        candidates: { id: string; ageMatch: string }[];
      }>;
      resolveReferenceRange: (
        ...a: unknown[]
      ) => Promise<{ referenceRangeId: string | null }>;
    };
    svc.prisma = prisma;
    return svc;
  };
  const query = { resultParamId: 'p1' };
  const list = (rows: unknown[], p: Patient) =>
    build(rows, p).listReferenceRangeCandidates('rep', 't1', 'b1', query);
  const resolve = (rows: unknown[], p: Patient) =>
    build(rows, p).resolveReferenceRange('rep', 't1', 'b1', query);

  describe('a patient aged 30 days, with "0-30 Days" and "1-11 Months" (a calendar edge)', () => {
    const days = rangeRow('0-30-days', 0, D, 30, D);
    const months = rangeRow('1-11-months', 1, M, 11, M);
    const patient = { age: 30, ageType: AgeType.DAYS };

    it.each([
      ['database order days, months', [days, months]],
      ['database order months, days', [months, days]],
    ])(
      'lists the certain fit first and the possible one second, whatever the database order (%s)',
      async (_label, rows) => {
        const res = await list(rows, patient);
        expect(res.candidates.map((c) => [c.id, c.ageMatch])).toEqual([
          ['0-30-days', 'match'],
          ['1-11-months', 'partial'],
        ]);
      },
    );

    it('resolve picks only the certain fit', async () => {
      expect((await resolve([months, days], patient)).referenceRangeId).toBe(
        '0-30-days',
      );
    });
  });

  describe('the reported gap: a patient stored as "12 Months"', () => {
    const under = rangeRow('1-11-months', 1, M, 11, M);
    const over = rangeRow('1-5-years', 1, Y, 5, Y);
    const patient = { age: 12, ageType: AgeType.MONTHS };

    it('gets the "1 Year to 5 Years" range (before: 360 days fell into a gap and nothing matched)', async () => {
      const res = await list([under, over], patient);
      expect(res.candidates.map((c) => c.id)).toEqual(['1-5-years']);
      expect((await resolve([under, over], patient)).referenceRangeId).toBe(
        '1-5-years',
      );
    });
  });

  describe('a stored age too coarse to be sure ("1 Year" against month bands)', () => {
    const first = rangeRow('0-17-months', 0, M, 17, M);
    const second = rangeRow('18-23-months', 18, M, 23, M);
    const patient = { age: 1, ageType: AgeType.YEARS };

    it('lists both as possible but picks neither automatically', async () => {
      const res = await list([first, second], patient);
      expect(res.candidates.map((c) => [c.id, c.ageMatch]).sort()).toEqual([
        ['0-17-months', 'partial'],
        ['18-23-months', 'partial'],
      ]);
      expect(
        (await resolve([first, second], patient)).referenceRangeId,
      ).toBeNull();
    });

    it('a certain fit is still found and listed before the possible ones', async () => {
      const exact = rangeRow('12-23-months', 12, M, 23, M);
      const res = await list([first, exact, second], patient);
      expect(res.candidates[0]).toMatchObject({
        id: '12-23-months',
        ageMatch: 'match',
      });
      expect(
        (await resolve([first, exact, second], patient)).referenceRangeId,
      ).toBe('12-23-months');
    });
  });

  describe('a newborn aged 0 days is a real age, not a missing one', () => {
    const newborn = rangeRow('0-28-days', 0, D, 28, D);
    const adult = rangeRow('18-60-years', 18, Y, 60, Y);

    it('is offered only the newborn range, never the adult one', async () => {
      const zero = { age: 0, ageType: AgeType.DAYS };
      const res = await list([adult, newborn], zero);
      expect(res.candidates.map((c) => c.id)).toEqual(['0-28-days']);
      expect((await resolve([adult, newborn], zero)).referenceRangeId).toBe(
        '0-28-days',
      );
    });

    it('a patient aged 29 days matches neither range (the 28-day band has ended)', async () => {
      const res = await list([adult, newborn], {
        age: 29,
        ageType: AgeType.DAYS,
      });
      expect(res.candidates).toEqual([]);
    });

    it('a patient with no age at all still sees every range listed, but none of them is a certain fit', async () => {
      const res = await list([adult, newborn], {
        age: null,
        ageType: AgeType.DAYS,
      });
      expect(res.candidates.map((c) => c.id).sort()).toEqual([
        '0-28-days',
        '18-60-years',
      ]);
      expect(res.candidates.every((c) => c.ageMatch === 'unknown')).toBe(true);
    });
  });

  it('a middle-aged patient gets the adult range as a certain fit', async () => {
    const res = await list(
      [
        rangeRow('0-17-years', 0, Y, 17, Y),
        rangeRow('18-60-years', 18, Y, 60, Y),
      ],
      { age: 34, ageType: AgeType.YEARS },
    );
    expect(res.candidates.map((c) => [c.id, c.ageMatch])).toEqual([
      ['18-60-years', 'match'],
    ]);
  });

  describe('the order of the list never depends on the database row order', () => {
    const adult = (id: string, extra: Record<string, unknown> = {}) =>
      rangeRow(id, 18, Y, 60, Y, extra);
    const patient = { age: 34, ageType: AgeType.YEARS };
    const permutations = <T>(items: T[]): T[][] =>
      items.length <= 1
        ? [items]
        : items.flatMap((item, i) =>
            permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(
              (rest) => [item, ...rest],
            ),
          );

    it('Default first, then a range without an analyzer first, then a fixed order', async () => {
      const rows = [
        adult('none-default', { isDefault: true }),
        adult('A1-default', { isDefault: true, labAdapterId: 'A1' }),
        adult('A2-default', { isDefault: true, labAdapterId: 'A2' }),
        adult('none-plain', { isDefault: false }),
        adult('A1-plain', { isDefault: false, labAdapterId: 'A1' }),
      ];
      const expected = [
        'none-default',
        'A1-default',
        'A2-default',
        'none-plain',
        'A1-plain',
      ];
      for (const perm of permutations(rows)) {
        const res = await list(perm, patient);
        expect(res.candidates.map((c) => c.id)).toEqual(expected);
      }
    });

    it('the automatic pick therefore stays the same: the first Default is always the one without an analyzer', async () => {
      const rows = [
        adult('A2-default', { isDefault: true, labAdapterId: 'A2' }),
        adult('A1-default', { isDefault: true, labAdapterId: 'A1' }),
        adult('none-default', { isDefault: true }),
      ];
      for (const perm of permutations(rows)) {
        const res = await list(perm, patient);
        expect(res.candidates[0]!.id).toBe('none-default');
      }
    });

    it('a certain age fit still comes before an "age may fit" range, even when the latter is the Default', async () => {
      const certain = rangeRow('certain', 0, Y, 17, Y, { isDefault: false });
      const maybe = rangeRow('maybe', 18, AgeUnit.MONTHS, 23, AgeUnit.MONTHS, {
        isDefault: true,
      });
      for (const perm of permutations([certain, maybe])) {
        const res = await list(perm, { age: 1, ageType: AgeType.YEARS });
        // "1 Year" is certainly inside 0-17 Years, and only possibly inside 18-23 Months:
        // the certain fit is first even though the possible one is the Default.
        expect(res.candidates.map((c) => [c.id, c.ageMatch])).toEqual([
          ['certain', 'match'],
          ['maybe', 'partial'],
        ]);
      }
      const exact = rangeRow('exact', 12, AgeUnit.MONTHS, 23, AgeUnit.MONTHS, {
        isDefault: false,
      });
      for (const perm of permutations([exact, maybe])) {
        const res = await list(perm, { age: 1, ageType: AgeType.YEARS });
        expect(res.candidates.map((c) => c.id)).toEqual(['exact', 'maybe']);
      }
    });

    it('same Default, analyzer, method and unit: the oldest saved comes first', async () => {
      const older = adult('older', {
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      const newer = adult('newer', {
        createdAt: new Date('2026-06-01T00:00:00Z'),
      });
      for (const perm of permutations([newer, older])) {
        const res = await list(perm, patient);
        expect(res.candidates.map((c) => c.id)).toEqual(['older', 'newer']);
      }
    });
  });
});

describe('a patient with NO age (and no date of birth): only a range that fits everybody may be picked', () => {
  const band = (
    ageFrom: number,
    ageFromUnit: AgeUnit,
    ageTo: number,
    ageToUnit: AgeUnit,
  ) => ({ ageFrom, ageFromUnit, ageTo, ageToUnit });
  const noAge = { age: null, ageType: null };

  it.each([
    [0, Y, 999, Y, true],
    [0, Y, 120, Y, true],
    [0, Y, 119, Y, false],
    [0, M, 1440, M, true],
    [0, M, 1439, M, false],
    [0, D, 43800, D, true],
    [0, D, 43000, D, false],
    [0, D, 999, Y, true],
    [1, Y, 999, Y, false],
    [18, Y, 999, Y, false],
    [0, Y, 17, Y, false],
  ])('range %i %s .. %i %s covers all ages: %s', (f, fu, t, tu, expected) => {
    expect(coversAllAges(band(f, fu, t, tu))).toBe(expected);
  });

  it('candidateAgeMatch: no age + all-ages range = match; no age + any other range = unknown', () => {
    expect(candidateAgeMatch(noAge, band(0, Y, 999, Y))).toBe('match');
    expect(candidateAgeMatch(noAge, band(0, Y, 17, Y))).toBe('unknown');
    expect(candidateAgeMatch(noAge, band(18, Y, 999, Y))).toBe('unknown');
    expect(
      candidateAgeMatch(
        { age: undefined, ageType: AgeType.YEARS },
        band(18, Y, 60, Y),
      ),
    ).toBe('unknown');
  });

  it('candidateAgeMatch: with an age it is exactly rangeAgeMatch (age 0 is a real age)', () => {
    for (const age of [0, 1, 30, 34, 90]) {
      for (const b of [
        band(0, Y, 17, Y),
        band(18, Y, 60, Y),
        band(0, D, 28, D),
        band(0, Y, 999, Y),
      ]) {
        const patient = { age, ageType: AgeType.YEARS };
        expect(candidateAgeMatch(patient, b)).toBe(rangeAgeMatch(patient, b));
      }
    }
    expect(
      candidateAgeMatch({ age: 0, ageType: AgeType.DAYS }, band(18, Y, 60, Y)),
    ).toBe('none');
  });

  it('candidateAgeRank: certain fits first, then ranges that cannot be told, then maybes', () => {
    expect(
      ['partial', 'unknown', 'match'].sort(
        (a, b) => candidateAgeRank(a as never) - candidateAgeRank(b as never),
      ),
    ).toEqual(['match', 'unknown', 'partial']);
  });

  it('the text-type lookups are unchanged: with no age they may still pick (rangeAgeMatch)', () => {
    expect(isExactAgeMatch(rangeAgeMatch(noAge, band(0, Y, 17, Y)))).toBe(true);
  });
});

describe('LabReportService — the Range list for a patient with no age', () => {
  const row = (
    id: string,
    ageFrom: number,
    ageTo: number,
    isDefault = true,
  ) => ({
    id,
    labAdapterId: null,
    method: null,
    unit: 'g/dL',
    isDefault,
    gender: 'ALL',
    ageFrom,
    ageFromUnit: Y,
    ageTo,
    ageToUnit: Y,
    lowerLimit: { toString: () => '12' },
    upperLimit: { toString: () => '16' },
    displayOfReferenceRange: id,
  });
  const listFor = async (
    rows: unknown[],
    patient: { age: number | null; ageType: AgeType | null },
  ) => {
    const prisma = {
      labReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rep',
          labTestId: 'lt',
          orderItem: { order: { patient: { ...patient, gender: 'MALE' } } },
        }),
      },
      labTestResultParam: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'p1', resultType: 'QUANTITATIVE' }),
      },
      labTestReferenceRange: { findMany: jest.fn().mockResolvedValue(rows) },
      labAdapter: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = Object.create(LabReportService.prototype) as unknown as {
      prisma: unknown;
      listReferenceRangeCandidates: (
        ...a: unknown[]
      ) => Promise<{ candidates: { id: string; ageMatch: string }[] }>;
    };
    svc.prisma = prisma;
    return (
      await svc.listReferenceRangeCandidates('rep', 't1', 'b1', {
        resultParamId: 'p1',
      })
    ).candidates.map((c) => [c.id, c.ageMatch]);
  };

  it('an all-ages range is a certain fit and comes first; child/adult ranges are listed but unknown', async () => {
    const got = await listFor(
      [row('0-17', 0, 17), row('18-999', 18, 999), row('all-ages', 0, 999)],
      { age: null, ageType: null },
    );
    expect(got).toEqual([
      ['all-ages', 'match'],
      ['0-17', 'unknown'],
      ['18-999', 'unknown'],
    ]);
  });

  it('only age-specific ranges: every one is unknown (nothing is a certain fit, so nothing is picked automatically)', async () => {
    const got = await listFor([row('0-17', 0, 17), row('18-999', 18, 999)], {
      age: null,
      ageType: null,
    });
    expect(got.every(([, m]) => m === 'unknown')).toBe(true);
    expect(got).toHaveLength(2);
  });

  it('a patient WITH an age is unaffected: an all-ages range is a certain fit like any other', async () => {
    const got = await listFor(
      [row('0-17', 0, 17), row('18-999', 18, 999), row('all-ages', 0, 999)],
      { age: 34, ageType: AgeType.YEARS },
    );
    expect(got.map(([id]) => id).sort()).toEqual(['18-999', 'all-ages']);
    expect(got.every(([, m]) => m === 'match')).toBe(true);
  });
});
