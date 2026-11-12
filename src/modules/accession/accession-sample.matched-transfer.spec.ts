import { Prisma, SampleStatus, TransferKind } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';

/**
 * A transfer filter (Sent To, Forwarded To, outsource center, send / forward / outsource date) finds a
 * sample by the transfer that MET it, which may not be its latest one. The list row then carries that
 * transfer as `matchedTransfer` (the label / Send details describe it) while `transfers[0]` stays the
 * live one (the row's actions follow it). Case from the manager: A -> B (B rejects, 28th), then A -> C
 * (30th); "B + 28th" must still list the row and describe the transfer to B.
 */
describe('OrderSampleService.findAll - matched transfer', () => {
  const settings = {
    resolve: jest.fn().mockResolvedValue({
      Accession_MaximumTimeToAcceptSampleMinutes: 100,
      Accession_WarningThresholdMinutes: 60,
      Accession_CriticalThresholdMinutes: 30,
    }),
  };
  const sampleFindMany = jest.fn();
  const transferFindMany = jest.fn<
    Promise<unknown[]>,
    [{ where: Prisma.SampleTransferWhereInput }]
  >();
  const branchFindMany = jest.fn();
  const tx = {
    orderSample: { findMany: sampleFindMany, count: jest.fn() },
    sampleTransfer: { findMany: transferFindMany },
    branch: { findMany: branchFindMany },
    outsourceCenter: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx),
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
  };
  let service: OrderSampleService;

  const transfer = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    kind: TransferKind.INTERNAL,
    transferStatus: 'IN_TRANSIT',
    destinationBranchId: null,
    outsourceCenterId: null,
    externalPartnerName: null,
    sendDate: new Date('2026-10-30T00:00:00.000Z'),
    sendTime: null,
    sampleForm: null,
    logisticsType: null,
    logisticsPerson: null,
    createdAt: new Date('2026-10-30T09:00:00.000Z'),
    rejectionReason: null,
    repeatReason: null,
    ...over,
  });
  const row = (id: string, status: SampleStatus, latest?: unknown) => ({
    id,
    status,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    transfers: latest ? [latest] : [],
  });

  beforeEach(() => {
    sampleFindMany.mockReset();
    tx.sampleTransfer.findMany.mockReset().mockResolvedValue([]);
    tx.orderSample.count.mockReset().mockResolvedValue(1);
    branchFindMany.mockReset().mockResolvedValue([
      { id: 'bB', name: 'Branch B' },
      { id: 'bC', name: 'Branch C' },
    ]);
    service = new OrderSampleService(
      prisma as never,
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

  const list = (query: Record<string, unknown>) =>
    service.findAll('t1', 'bA', query, 'p1');

  it('asks for no matched transfer, and adds none, without a transfer filter', async () => {
    sampleFindMany.mockResolvedValue([
      row('s1', SampleStatus.SENT_INTERNAL, transfer('tC')),
    ]);
    const r = await list({ search: 'x' });
    expect(transferFindMany).not.toHaveBeenCalled();
    expect(r.data[0]).not.toHaveProperty('matchedTransfer');
  });

  it('B + the 28th: the row keeps the live transfer to C and carries the matched one to B', async () => {
    sampleFindMany.mockResolvedValue([
      row(
        's1',
        SampleStatus.SENT_INTERNAL,
        transfer('tC', { destinationBranchId: 'bC' }),
      ),
    ]);
    transferFindMany.mockResolvedValue([
      {
        ...transfer('tB', {
          destinationBranchId: 'bB',
          transferStatus: 'REJECTED',
          sendDate: new Date('2026-10-28T00:00:00.000Z'),
          createdAt: new Date('2026-10-28T09:00:00.000Z'),
        }),
        sampleId: 's1',
      },
    ]);

    const r = await list({ destinationBranchId: 'bB', sendDate: '2026-10-28' });

    // ONE query, and it asks for the destination AND the day on the same transfer
    expect(transferFindMany).toHaveBeenCalledTimes(1);
    const where = transferFindMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      tenantId: 't1',
      sampleId: { in: ['s1'] },
      deletedAt: null,
      kind: TransferKind.INTERNAL,
    });
    expect(JSON.stringify(where.AND)).toContain('"destinationBranchId":"bB"');
    expect(JSON.stringify(where.AND)).toContain('sendDate');

    const item = r.data[0]!;
    expect(item.transfers[0]).toMatchObject({
      id: 'tC',
      destinationBranchName: 'Branch C',
    });
    expect(item.matchedTransfer).toMatchObject({
      id: 'tB',
      transferStatus: 'REJECTED',
      destinationBranchName: 'Branch B',
    });
    expect(item.matchedTransfer).not.toHaveProperty('sampleId');
  });

  it('keeps the newest matching transfer when a sample has several', async () => {
    sampleFindMany.mockResolvedValue([
      row('s1', SampleStatus.SENT_INTERNAL, transfer('t3')),
    ]);
    transferFindMany.mockResolvedValue([
      { ...transfer('t2'), sampleId: 's1' },
      {
        ...transfer('t1', { createdAt: new Date('2026-10-01T00:00:00.000Z') }),
        sampleId: 's1',
      },
    ]);
    const r = await list({ sendDate: '2026-10-30' });
    expect(r.data[0]!.matchedTransfer).toMatchObject({ id: 't2' });
  });

  it('with two kinds asked, the matched transfer is the one of the kind that fits the row status', async () => {
    sampleFindMany.mockResolvedValue([
      row('s1', SampleStatus.OUTSOURCED, transfer('tO')),
    ]);
    transferFindMany
      .mockResolvedValueOnce([
        {
          ...transfer('tI', {
            createdAt: new Date('2026-10-31T00:00:00.000Z'),
          }),
          sampleId: 's1',
        },
      ])
      .mockResolvedValueOnce([
        {
          ...transfer('tOut', { kind: TransferKind.OUTSOURCE }),
          sampleId: 's1',
        },
      ]);
    const r = await list({
      sendDate: '2026-10-30',
      outsourceDate: '2026-10-30',
    });
    expect(transferFindMany).toHaveBeenCalledTimes(2);
    expect(r.data[0]!.matchedTransfer).toMatchObject({ id: 'tOut' });
  });

  it('a row without a matching transfer gets no matchedTransfer', async () => {
    sampleFindMany.mockResolvedValue([
      row('s1', SampleStatus.ACCEPTED),
      row('s2', SampleStatus.SENT_INTERNAL, transfer('t9')),
    ]);
    transferFindMany.mockResolvedValue([{ ...transfer('t9'), sampleId: 's2' }]);
    const r = await list({ sendDate: '2026-10-30' });
    expect(r.data[0]).not.toHaveProperty('matchedTransfer');
    expect(r.data[1]!.matchedTransfer).toMatchObject({ id: 't9' });
  });
});
