import { Prisma, SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import { ListSamplesDto } from './dto/list-samples.dto';
import {
  TAT_STATUSES,
  TERMINAL_SAMPLE_STATUSES,
  tatCreatedAtRange,
} from './constants/tat.constant';

/**
 * Accession → In-House Orders: the status tabs (§A.5) and TAT cards (§A.4). They
 * must follow the list's filters (date range, search, doctor, …) but NOT the
 * tab/card that is currently selected, and each card must use exactly the rule
 * the list's TAT filter uses.
 */
describe('OrderSampleService.summary — filters, selection and TAT rule', () => {
  const NOW = new Date('2026-10-08T10:00:00.000Z');
  // max 100 min; warning at 100-60=40, critical at 100-30=70, breached at 100
  const settings = {
    resolve: jest.fn().mockResolvedValue({
      Accession_MaximumTimeToAcceptSampleMinutes: 100,
      Accession_WarningThresholdMinutes: 60,
      Accession_CriticalThresholdMinutes: 30,
    }),
  };
  const TAT = { warningMinutes: 40, criticalMinutes: 70, breachedMinutes: 100 };

  type CountArgs = { where: Prisma.OrderSampleWhereInput };
  const groupBy = jest.fn<
    Promise<unknown[]>,
    [{ where: Prisma.OrderSampleWhereInput }]
  >();
  const count = jest.fn<Promise<number>, [CountArgs]>();
  const resolveDepartmentIds = jest.fn<Promise<string[]>, []>();
  let service: OrderSampleService;

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterAll(() => jest.useRealTimers());

  beforeEach(() => {
    groupBy.mockReset().mockResolvedValue([
      { status: SampleStatus.NEW, _count: { _all: 5 } },
      { status: SampleStatus.ACCEPTED, _count: { _all: 3 } },
    ]);
    count.mockReset().mockResolvedValue(0);
    resolveDepartmentIds.mockReset().mockResolvedValue([]);
    service = new OrderSampleService(
      { orderSample: { groupBy, count } } as never,
      settings as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      { resolveDepartmentIds } as never,
    );
  });

  const run = (query?: Partial<ListSamplesDto>) =>
    service.summary('t1', 'b1', 'p1', query);
  const groupWhere = () =>
    (groupBy.mock.calls[0] as [{ where: Prisma.OrderSampleWhereInput }])[0]
      .where;

  it('returns a count per status (zero for the rest), a total and the TAT bands', async () => {
    count.mockImplementation(({ where }) => {
      const range = (
        (where.AND as Prisma.OrderSampleWhereInput[])[2] as {
          createdAt: Prisma.DateTimeFilter;
        }
      ).createdAt;
      return Promise.resolve(
        JSON.stringify(range) ===
          JSON.stringify(tatCreatedAtRange('BREACHED', TAT, NOW.getTime()))
          ? 8
          : 0,
      );
    });
    const r = await run();
    expect(r.total).toBe(8);
    expect(r.byStatus[SampleStatus.NEW]).toBe(5);
    expect(r.byStatus[SampleStatus.ACCEPTED]).toBe(3);
    expect(r.byStatus[SampleStatus.COLLECTED]).toBe(0);
    expect(r.byTat).toEqual({
      WITHIN: 0,
      WARNING: 0,
      CRITICAL: 0,
      BREACHED: 8,
    });
  });

  it('works with no filters at all (the old behaviour)', async () => {
    await expect(run(undefined)).resolves.toMatchObject({ total: 8 });
    expect(groupWhere()).toMatchObject({
      tenantId: 't1',
      branchId: 'b1',
      deletedAt: null,
    });
  });

  describe('follows the list filters', () => {
    it('applies the date range to the order date', async () => {
      await run({ dateFrom: '2026-10-05', dateTo: '2026-10-06' });
      expect(groupWhere().order).toEqual({
        orderDate: {
          gte: new Date('2026-10-05'),
          lte: new Date('2026-10-06'),
        },
      });
    });

    it('applies the doctor and referral panel', async () => {
      await run({ referredByDoctorId: 'doc-1', referralPanelId: 'panel-1' });
      expect(groupWhere().order).toMatchObject({
        referredByDoctorId: 'doc-1',
        referralPanelId: 'panel-1',
      });
    });

    it('applies the search text', async () => {
      await run({ search: 'asha' });
      expect(JSON.stringify(groupWhere().AND)).toContain('asha');
    });

    it('keeps the department visibility scope', async () => {
      resolveDepartmentIds.mockResolvedValue(['dept-1']);
      await run();
      expect(JSON.stringify(groupWhere().AND)).toContain('dept-1');
    });

    it('every TAT band count uses the same filters as the tabs', async () => {
      await run({ dateFrom: '2026-10-05', dateTo: '2026-10-06' });
      expect(count).toHaveBeenCalledTimes(TAT_STATUSES.length);
      for (const [{ where }] of count.mock.calls) {
        const first = (where.AND as Prisma.OrderSampleWhereInput[])[0]!;
        expect(first.order).toEqual(groupWhere().order);
        expect(first.tenantId).toBe('t1');
      }
    });
  });

  describe('ignores the selected tab and TAT card', () => {
    it('a selected status does not narrow the counts', async () => {
      await run({ status: SampleStatus.NEW });
      expect(groupWhere().status).toBeUndefined();
    });

    it('a selected TAT card does not narrow the counts', async () => {
      await run({ tatStatus: 'BREACHED' });
      expect(groupWhere().createdAt).toBeUndefined();
    });

    it('paging is ignored', async () => {
      await run({ page: 3, limit: 5 });
      expect(groupWhere()).not.toHaveProperty('skip');
      expect(groupBy.mock.calls[0]![0]).not.toHaveProperty('skip');
    });

    it('selecting a tab and a card gives the same counts as selecting nothing', async () => {
      await run();
      const plain = JSON.stringify([groupBy.mock.calls[0], count.mock.calls]);
      groupBy.mockClear();
      count.mockClear();
      await run({ status: SampleStatus.NEW, tatStatus: 'CRITICAL', page: 2 });
      expect(JSON.stringify([groupBy.mock.calls[0], count.mock.calls])).toBe(
        plain,
      );
    });
  });

  describe('each TAT card uses exactly the list filter rule', () => {
    it.each([...TAT_STATUSES])(
      '%s: same createdAt range and open-status rule',
      async (band) => {
        await run();
        const countWhere = count.mock.calls
          .map(([a]) => a.where.AND as Prisma.OrderSampleWhereInput[])
          .find(
            (and) =>
              JSON.stringify((and[2] as { createdAt: unknown }).createdAt) ===
              JSON.stringify(tatCreatedAtRange(band, TAT, NOW.getTime())),
          );
        expect(countWhere).toBeDefined();
        // the list's TAT filter: same range, and terminal samples excluded
        const listWhere = (
          service as unknown as {
            buildSampleWhere: (
              t: string,
              b: string | null,
              q: ListSamplesDto,
              tat: typeof TAT,
              now: number,
              scope: string[],
            ) => Prisma.OrderSampleWhereInput;
          }
        ).buildSampleWhere(
          't1',
          'b1',
          { tatStatus: band },
          TAT,
          NOW.getTime(),
          [],
        );
        expect(listWhere.createdAt).toEqual(
          (countWhere![2] as { createdAt: unknown }).createdAt,
        );
        expect(listWhere.status).toEqual(
          (countWhere![1] as { status: unknown }).status,
        );
        expect(countWhere![1]).toEqual({
          status: { notIn: [...TERMINAL_SAMPLE_STATUSES] },
        });
      },
    );
  });

  it('counts in the database — never loads sample rows into memory', async () => {
    const findMany = jest.fn();
    service = new OrderSampleService(
      { orderSample: { groupBy, count, findMany } } as never,
      settings as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      { resolveDepartmentIds } as never,
    );
    await run();
    expect(findMany).not.toHaveBeenCalled();
  });
});
