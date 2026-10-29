import { Prisma, SampleStatus, TransferKind } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OrderSampleService } from './accession-sample.service';
import { ListSamplesDto } from './dto/list-samples.dto';

/**
 * The sender's "where did I send it" filters: Sent To (branch), Forward Partner and Logistics. All three
 * read the TRANSFER (a Send / Forward / Outsource records where, when and how on the transfer, never on
 * the sample) of a sample that is out right now. They are applied by the shared `buildSampleWhere`, so
 * the tab counts (summary) and the list follow them identically - asserted here through `summary`.
 */
describe('OrderSampleService - sent-to / forward-partner / logistics filters', () => {
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
  let service: OrderSampleService;

  beforeEach(() => {
    groupBy.mockReset().mockResolvedValue([]);
    service = new OrderSampleService(
      { orderSample: { groupBy, count: jest.fn() } } as never,
      settings as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      { resolveDepartmentIds: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
    );
  });

  const whereFor = async (query: Partial<ListSamplesDto>) => {
    await service.summary('t1', 'b1', 'p1', query);
    return groupBy.mock.calls[0]![0].where;
  };
  const andOf = (w: Prisma.OrderSampleWhereInput) =>
    (w.AND ?? []) as Prisma.OrderSampleWhereInput[];

  it('"Sent to" matches a sample that is Sent now, through its INTERNAL transfer to that branch', async () => {
    const w = await whereFor({ destinationBranchId: 'br-2' });
    expect(andOf(w)).toContainEqual({
      status: SampleStatus.SENT_INTERNAL,
      transfers: {
        some: {
          deletedAt: null,
          kind: TransferKind.INTERNAL,
          destinationBranchId: 'br-2',
        },
      },
    });
  });

  it('"Forward partner" matches a sample Forwarded now, by part of the partner name (case-insensitive, trimmed)', async () => {
    const w = await whereFor({ externalPartnerName: '  Pathkind ' });
    expect(andOf(w)).toContainEqual({
      status: SampleStatus.FORWARD_EXTERNAL,
      transfers: {
        some: {
          deletedAt: null,
          kind: TransferKind.EXTERNAL,
          externalPartnerName: { contains: 'Pathkind', mode: 'insensitive' },
        },
      },
    });
  });

  it('"%" and "_" typed in the partner filter are matched literally (escaped for LIKE), not as wildcards', async () => {
    const w = await whereFor({ externalPartnerName: '50%_off\\' });
    expect(andOf(w)).toContainEqual({
      status: SampleStatus.FORWARD_EXTERNAL,
      transfers: {
        some: {
          deletedAt: null,
          kind: TransferKind.EXTERNAL,
          externalPartnerName: {
            contains: '50\\%\\_off\\\\',
            mode: 'insensitive',
          },
        },
      },
    });
  });

  it('a blank partner adds no condition at all', async () => {
    const w = await whereFor({ externalPartnerName: '   ' });
    expect(JSON.stringify(w)).not.toContain('externalPartnerName');
  });

  it('Logistics reads the transfer of a sample that is out (the sample column is only an alternative)', async () => {
    const w = await whereFor({ logisticsType: 'Courier' });
    expect(w.logisticsType).toBeUndefined(); // no longer matched on the sample column alone
    expect(andOf(w)).toContainEqual({
      OR: [
        { logisticsType: 'Courier' },
        {
          status: {
            in: expect.arrayContaining([
              SampleStatus.SENT_INTERNAL,
              SampleStatus.FORWARD_EXTERNAL,
              SampleStatus.OUTSOURCED,
            ]) as SampleStatus[],
          },
          transfers: { some: { deletedAt: null, logisticsType: 'Courier' } },
        },
      ],
    });
  });

  it('they combine with the other filters', async () => {
    const w = await whereFor({
      destinationBranchId: 'br-2',
      logisticsType: 'Courier',
      sendDate: '2026-10-24',
      outsourceCenterId: 'oc-1',
    });
    expect(andOf(w).length).toBeGreaterThanOrEqual(4);
  });

  it('adds nothing when none of them is set', async () => {
    const w = await whereFor({});
    expect(JSON.stringify(w)).not.toContain('SENT_INTERNAL');
    expect(JSON.stringify(w)).not.toContain('logisticsType');
  });
});

describe('ListSamplesDto - destinationBranchId / externalPartnerName', () => {
  const check = (obj: Record<string, unknown>) =>
    validateSync(plainToInstance(ListSamplesDto, obj));

  it('accepts a branch id and a partner name', () => {
    expect(
      check({
        destinationBranchId: '0d8af0ee-49f8-4860-aa5d-395a49391b7c',
        externalPartnerName: 'Pathkind',
      }),
    ).toHaveLength(0);
  });

  it('rejects a branch that is not a UUID and a partner name that is too long', () => {
    expect(check({ destinationBranchId: 'nope' }).length).toBeGreaterThan(0);
    expect(
      check({ externalPartnerName: 'x'.repeat(201) }).length,
    ).toBeGreaterThan(0);
  });
});

describe('OrderSampleService.withTransferNames - names for the Send details column', () => {
  const row = (transfer: Record<string, unknown> | null) => ({
    id: 's1',
    transfers: transfer ? [transfer] : [],
  });

  function setup(
    branches: Array<{ id: string; name: string }>,
    centers: Array<{ id: string; name: string }>,
  ) {
    const branchFind = jest
      .fn<Promise<Array<{ id: string; name: string }>>, [unknown]>()
      .mockResolvedValue(branches);
    const centerFind = jest
      .fn<Promise<Array<{ id: string; name: string }>>, [unknown]>()
      .mockResolvedValue(centers);
    const tx = {
      branch: { findMany: branchFind },
      outsourceCenter: { findMany: centerFind },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const svc = new OrderSampleService(
      prisma as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const names = (rows: unknown[]) =>
      (
        svc as unknown as {
          withTransferNames: (
            t: string,
            r: unknown[],
          ) => Promise<Array<{ transfers: Array<Record<string, unknown>> }>>;
        }
      ).withTransferNames('t1', rows);
    return { names, prisma, branchFind, centerFind };
  }

  it('resolves the destination branch and the outsource center in ONE lookup each, across all rows', async () => {
    const { names, branchFind, centerFind } = setup(
      [{ id: 'b1', name: 'Branch B' }],
      [{ id: 'c1', name: 'SRL Labs' }],
    );
    const out = await names([
      row({ destinationBranchId: 'b1', outsourceCenterId: null }),
      row({ destinationBranchId: null, outsourceCenterId: 'c1' }),
      row({ destinationBranchId: 'b1', outsourceCenterId: null }),
    ]);
    expect(branchFind).toHaveBeenCalledTimes(1);
    expect(centerFind).toHaveBeenCalledTimes(1);
    expect(out[0]!.transfers[0]).toMatchObject({
      destinationBranchName: 'Branch B',
      outsourceCenterName: null,
    });
    expect(out[1]!.transfers[0]).toMatchObject({
      destinationBranchName: null,
      outsourceCenterName: 'SRL Labs',
    });
    expect(out[2]!.transfers[0]).toMatchObject({
      destinationBranchName: 'Branch B',
    });
  });

  it('the lookup does not filter on deletedAt, so a deactivated branch or center keeps its name', async () => {
    const { names, branchFind, centerFind } = setup([], []);
    await names([row({ destinationBranchId: 'b1', outsourceCenterId: 'c1' })]);
    expect(JSON.stringify(branchFind.mock.calls[0]![0])).not.toContain(
      'deletedAt',
    );
    expect(JSON.stringify(centerFind.mock.calls[0]![0])).not.toContain(
      'deletedAt',
    );
  });

  it('an id with no match gets a null name; rows with no transfer cost no query at all', async () => {
    const a = setup([], []);
    const out = await a.names([
      row({ destinationBranchId: 'gone', outsourceCenterId: null }),
    ]);
    expect(out[0]!.transfers[0]!.destinationBranchName).toBeNull();
    const b = setup([], []);
    await b.names([
      row(null),
      row({ destinationBranchId: null, outsourceCenterId: null }),
    ]);
    expect(b.prisma.withTenant).not.toHaveBeenCalled();
  });
});
