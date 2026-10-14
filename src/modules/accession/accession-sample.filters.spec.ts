import { Prisma, SampleStatus, TransferKind } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OrderSampleService } from './accession-sample.service';
import { ListSamplesDto } from './dto/list-samples.dto';

/**
 * Accession → In-House Orders filter panel: the referral (user / center),
 * Outsource Station and Send / Forward / Outsource date filters. They are
 * applied by the shared `buildSampleWhere`, so the summary (tabs + TAT cards)
 * and the list follow them identically — asserted here through `summary`.
 */
describe('OrderSampleService — referral / outsource / transfer-date filters', () => {
  const settings = {
    resolve: jest.fn().mockResolvedValue({
      Accession_MaximumTimeToAcceptSampleMinutes: 100,
      Accession_WarningThresholdMinutes: 60,
      Accession_CriticalThresholdMinutes: 30,
    }),
  };
  const groupBy = jest.fn<
    Promise<unknown[]>,
    [{ where: Prisma.OrderSampleWhereInput }]
  >();
  const count = jest.fn<Promise<number>, []>();
  let service: OrderSampleService;

  beforeEach(() => {
    groupBy
      .mockReset()
      .mockResolvedValue([{ status: SampleStatus.NEW, _count: { _all: 1 } }]);
    count.mockReset().mockResolvedValue(0);
    service = new OrderSampleService(
      { orderSample: { groupBy, count } } as never,
      settings as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      { resolveDepartmentIds: jest.fn().mockResolvedValue([]) } as never,
    );
  });

  const whereFor = async (query: Partial<ListSamplesDto>) => {
    await service.summary('t1', 'b1', 'p1', query);
    return groupBy.mock.calls[0]![0].where;
  };
  const andOf = (w: Prisma.OrderSampleWhereInput) =>
    w.AND as Prisma.OrderSampleWhereInput[];
  const orderOf = (w: Prisma.OrderSampleWhereInput) =>
    w.order as Prisma.OrderWhereInput;
  const dayRange = (d: string) => {
    const next = new Date(`${d}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return { gte: new Date(d), lt: next };
  };

  it('applies no referral/transfer conditions when the filters are empty', async () => {
    const w = await whereFor({});
    expect(w.order).toBeUndefined();
    expect(JSON.stringify(w)).not.toContain('transfers');
  });

  it('filters by internal / external referral user', async () => {
    const w = await whereFor({
      internalReferralId: 'ir-1',
      externalReferralId: 'er-1',
    });
    expect(orderOf(w)).toMatchObject({
      internalReferralId: 'ir-1',
      externalReferralId: 'er-1',
    });
  });

  it('filters by internal referral center (branch) and external referral center (organisation)', async () => {
    const w = await whereFor({
      internalReferralBranchId: 'br-9',
      externalReferralOrganisation: 'Apollo Labs',
    });
    expect(orderOf(w).internalReferral).toEqual({ is: { branchId: 'br-9' } });
    expect(orderOf(w).externalReferral).toEqual({
      is: {
        organisationName: { equals: 'Apollo Labs', mode: 'insensitive' },
      },
    });
  });

  it('filters by outsource station through an OUTSOURCE transfer', async () => {
    const w = await whereFor({ outsourceCenterId: 'oc-1' });
    expect(andOf(w)).toContainEqual({
      transfers: {
        some: {
          deletedAt: null,
          kind: TransferKind.OUTSOURCE,
          outsourceCenterId: 'oc-1',
        },
      },
    });
  });

  it.each([
    ['sendDate', TransferKind.INTERNAL],
    ['forwardDate', TransferKind.EXTERNAL],
    ['outsourceDate', TransferKind.OUTSOURCE],
  ] as const)(
    '%s matches a %s transfer on that whole day (sendDate, else createdAt)',
    async (param, kind) => {
      const w = await whereFor({ [param]: '2026-10-05' });
      const range = dayRange('2026-10-05');
      expect(andOf(w)).toContainEqual({
        transfers: {
          some: {
            deletedAt: null,
            kind,
            OR: [{ sendDate: range }, { sendDate: null, createdAt: range }],
          },
        },
      });
    },
  );

  it('combines several filters with AND without clobbering each other', async () => {
    const w = await whereFor({
      search: 'ram',
      isUrgent: true,
      outsourceCenterId: 'oc-1',
      sendDate: '2026-10-05',
      outsourceDate: '2026-10-06',
      internalReferralId: 'ir-1',
      referredByDoctorId: 'rd-1',
    });
    const transferConds = andOf(w).filter((c) => 'transfers' in c);
    expect(transferConds).toHaveLength(3);
    expect(andOf(w).some((c) => JSON.stringify(c).includes('ram'))).toBe(true);
    expect(orderOf(w)).toMatchObject({
      internalReferralId: 'ir-1',
      referredByDoctorId: 'rd-1',
    });
  });
});

describe('ListSamplesDto — transfer-date params', () => {
  const errorsFor = (sendDate: string) =>
    validateSync(plainToInstance(ListSamplesDto, { sendDate })).map(
      (e) => e.property,
    );

  it('accepts a real calendar day', () => {
    expect(errorsFor('2026-09-02')).toEqual([]);
  });

  it.each(['2026-13-45', '2026-02-30', '2026-09-02T10:00:00Z', 'yesterday'])(
    'rejects %s with a 400 (not a 500 from an Invalid Date)',
    (bad) => {
      expect(errorsFor(bad)).toEqual(['sendDate']);
    },
  );
});
