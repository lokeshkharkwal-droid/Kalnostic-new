import { AgeType, AgeUnit } from '@prisma/client';
import { LabReportService } from './lab-report.service';

/**
 * Which reference range the technician side offers when the patient's exact birth date is
 * known (a saved date of birth, or — for a patient who only ever gave an age — the day the
 * record was created minus that age). The patient's age is measured on the day the sample
 * was collected, so the calendar decides: nothing is left "partial", and a patient who
 * registered years ago is not treated as still being the age they gave back then.
 */
describe('LabReportService — reference range by exact age on the collection day', () => {
  const D = AgeUnit.DAYS;
  const M = AgeUnit.MONTHS;
  const Y = AgeUnit.YEARS;
  const range = (
    id: string,
    from: number,
    fromUnit: AgeUnit,
    to: number,
    toUnit: AgeUnit,
  ) => ({
    id,
    labAdapterId: null,
    method: null,
    unit: 'g/dL',
    isDefault: true,
    gender: 'ALL',
    ageFrom: from,
    ageFromUnit: fromUnit,
    ageTo: to,
    ageToUnit: toUnit,
    lowerLimit: { toString: () => '12' },
    upperLimit: { toString: () => '16' },
    displayOfReferenceRange: id,
  });

  type Patient = {
    age: number | null;
    ageType: AgeType | null;
    dateOfBirth?: Date | null;
    createdAt?: Date | null;
  };

  const build = (
    rows: unknown[],
    patient: Patient,
    opts: {
      collectedAt?: Date | null;
      /** several samples of the report (the earliest collection counts) */
      collectedAtList?: Date[];
      orderDate?: Date | null;
      timezone?: string;
    } = {},
  ) => {
    const prisma = {
      labReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rep',
          labTestId: 'lt',
          orderItemId: 'oi',
          memberBranchLabTestId: null,
          orderItem: {
            order: {
              orderDate: opts.orderDate ?? null,
              patient: { ...patient, gender: 'MALE' },
            },
          },
        }),
      },
      orderSampleTest: {
        findMany: jest.fn().mockResolvedValue(
          opts.collectedAtList
            ? opts.collectedAtList.map((d) => ({
                sample: { collectedAt: d },
              }))
            : opts.collectedAt
              ? [{ sample: { collectedAt: opts.collectedAt } }]
              : [],
        ),
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
      tenantService: unknown;
      listReferenceRangeCandidates: (
        ...a: unknown[]
      ) => Promise<{ candidates: { id: string; ageMatch: string }[] }>;
      resolveReferenceRange: (
        ...a: unknown[]
      ) => Promise<{ referenceRangeId: string | null }>;
    };
    svc.prisma = prisma;
    svc.tenantService = {
      getLocale: jest
        .fn()
        .mockResolvedValue({ timezone: opts.timezone ?? 'Asia/Kolkata' }),
    };
    return svc;
  };
  const query = { resultParamId: 'p1' };
  const offered = async (
    rows: unknown[],
    p: Patient,
    o?: Parameters<typeof build>[2],
  ) =>
    (
      await build(rows, p, o).listReferenceRangeCandidates(
        'rep',
        't1',
        'b1',
        query,
      )
    ).candidates.map((c) => `${c.id}:${c.ageMatch}`);

  const COLLECTED = new Date('2026-10-13T06:00:00Z'); // 13 Oct on the branch calendar

  describe('a saved date of birth', () => {
    const rows = [
      range('0-30-days', 0, D, 30, D),
      range('1-11-months', 1, M, 11, M),
    ];

    it('settles the "30 days" calendar edge exactly: a baby born 13 Sep is a full month old on 13 Oct', async () => {
      const dob = new Date('2026-09-13T00:00:00Z');
      expect(
        await offered(
          rows,
          { age: 30, ageType: AgeType.DAYS, dateOfBirth: dob },
          { collectedAt: COLLECTED },
        ),
      ).toEqual(['0-30-days:match', '1-11-months:match']);
    });

    it('a baby born 14 Jan is 30 days old on 13 Feb but not yet a month: only the days band fits', async () => {
      const dob = new Date('2026-01-14T00:00:00Z');
      expect(
        await offered(
          rows,
          { age: 30, ageType: AgeType.DAYS, dateOfBirth: dob },
          { collectedAt: new Date('2026-02-13T06:00:00Z') },
        ),
      ).toEqual(['0-30-days:match']);
    });

    it('wins over a saved age that says something else', async () => {
      const adultRows = [
        range('0-17', 0, Y, 17, Y),
        range('18-up', 18, Y, 999, Y),
      ];
      expect(
        await offered(
          adultRows,
          {
            age: 5,
            ageType: AgeType.YEARS,
            dateOfBirth: new Date('1980-01-01T00:00:00Z'),
          },
          { collectedAt: COLLECTED },
        ),
      ).toEqual(['18-up:match']);
    });

    it('is measured on the collection day, not today: a sample collected before the 18th birthday uses the child range', async () => {
      const adultRows = [
        range('0-17', 0, Y, 17, Y),
        range('18-up', 18, Y, 999, Y),
      ];
      const dob = new Date('2008-10-14T00:00:00Z');
      expect(
        await offered(
          adultRows,
          { age: 17, ageType: AgeType.YEARS, dateOfBirth: dob },
          { collectedAt: COLLECTED },
        ),
      ).toEqual(['0-17:match']); // 17 years 364 days
      expect(
        await offered(
          adultRows,
          { age: 17, ageType: AgeType.YEARS, dateOfBirth: dob },
          { collectedAt: new Date('2026-10-14T06:00:00Z') },
        ),
      ).toEqual(['18-up:match']); // turned 18 the next day
    });

    it('a collection at 01:30 on the branch calendar day counts as that day, not the UTC day before', async () => {
      const adultRows = [
        range('0-17', 0, Y, 17, Y),
        range('18-up', 18, Y, 999, Y),
      ];
      const dob = new Date('2008-10-13T00:00:00Z'); // 18th birthday on the 13th
      expect(
        await offered(
          adultRows,
          { age: 17, ageType: AgeType.YEARS, dateOfBirth: dob },
          { collectedAt: new Date('2026-10-12T20:00:00Z') }, // 13 Oct 01:30 in India
        ),
      ).toEqual(['18-up:match']);
      expect(
        await offered(
          adultRows,
          { age: 17, ageType: AgeType.YEARS, dateOfBirth: dob },
          { collectedAt: new Date('2026-10-12T20:00:00Z'), timezone: 'UTC' },
        ),
      ).toEqual(['0-17:match']);
    });
  });

  describe('a patient who only gave an age (the day the record was created minus that age)', () => {
    const adultRows = [
      range('0-17', 0, Y, 17, Y),
      range('18-up', 18, Y, 999, Y),
    ];

    it('registered as "17 years" two years ago is an adult now', async () => {
      const created = new Date('2024-10-13T05:00:00Z');
      expect(
        await offered(
          adultRows,
          { age: 17, ageType: AgeType.YEARS, createdAt: created },
          { collectedAt: COLLECTED },
        ),
      ).toEqual(['18-up:match']);
    });

    it('registered as "30 days" 100 days ago is a 4 month old now: the months band, not the days band', async () => {
      const rows = [
        range('0-30-days', 0, D, 30, D),
        range('1-11-months', 1, M, 11, M),
      ];
      const created = new Date('2026-07-05T06:00:00Z'); // 100 days before 13 Oct
      expect(
        await offered(
          rows,
          { age: 30, ageType: AgeType.DAYS, createdAt: created },
          { collectedAt: COLLECTED },
        ),
      ).toEqual(['1-11-months:match']);
    });

    it('registered today, sample collected today: the age is exactly what was told', async () => {
      const created = new Date('2026-10-13T04:00:00Z');
      expect(
        await offered(
          adultRows,
          { age: 17, ageType: AgeType.YEARS, createdAt: created },
          { collectedAt: COLLECTED },
        ),
      ).toEqual(['0-17:match']);
    });

    it('with no sample collection recorded, the order date is used', async () => {
      const created = new Date('2024-10-13T05:00:00Z');
      expect(
        await offered(
          adultRows,
          { age: 17, ageType: AgeType.YEARS, createdAt: created },
          { orderDate: new Date('2026-10-13T00:00:00Z') },
        ),
      ).toEqual(['18-up:match']);
    });

    it('the automatic pick (resolveReferenceRange) follows the same age', async () => {
      const created = new Date('2024-10-13T05:00:00Z');
      const out = await build(
        adultRows,
        { age: 17, ageType: AgeType.YEARS, createdAt: created },
        { collectedAt: COLLECTED },
      ).resolveReferenceRange('rep', 't1', 'b1', query);
      expect(out.referenceRangeId).toBe('18-up');
    });
  });

  describe('details', () => {
    const adultRows = [
      range('0-17', 0, Y, 17, Y),
      range('18-up', 18, Y, 999, Y),
    ];

    it('with several samples the EARLIEST collection day counts', async () => {
      const dob = new Date('2008-10-15T00:00:00Z'); // 18th birthday on 15 Oct
      expect(
        await offered(
          adultRows,
          { age: 17, ageType: AgeType.YEARS, dateOfBirth: dob },
          {
            collectedAtList: [
              new Date('2026-10-20T06:00:00Z'),
              new Date('2026-10-13T06:00:00Z'),
            ],
          },
        ),
      ).toEqual(['0-17:match']);
    });

    it('a saved date of birth is used even when no age was saved', async () => {
      const dob = new Date('1980-01-01T00:00:00Z');
      expect(
        await offered(
          adultRows,
          { age: null, ageType: null, dateOfBirth: dob },
          { collectedAt: COLLECTED },
        ),
      ).toEqual(['18-up:match']);
    });
  });

  describe('nothing exact is known', () => {
    it('with no date of birth and no creation date, the stored age is used as before (a coarse "partial" is still possible)', async () => {
      const rows = [
        range('0-30-days', 0, D, 30, D),
        range('1-11-months', 1, M, 11, M),
      ];
      expect(
        await offered(
          rows,
          { age: 30, ageType: AgeType.DAYS },
          { collectedAt: COLLECTED },
        ),
      ).toEqual(['0-30-days:match', '1-11-months:partial']);
    });

    it('with no age and no date of birth, only an all-ages range is picked', async () => {
      const rows = [range('0-17', 0, Y, 17, Y), range('all', 0, Y, 999, Y)];
      expect(
        await offered(
          rows,
          { age: null, ageType: null },
          { collectedAt: COLLECTED },
        ),
      ).toEqual(['all:match', '0-17:unknown']);
    });
  });
});
