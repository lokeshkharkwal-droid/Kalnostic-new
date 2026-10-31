import { LabReportStatus, OrderType, Prisma } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import { ListTransfersDto } from './dto/list-transfers.dto';

/**
 * Internal / External / Outsourced queues - the filter panel. Transfer-level filters
 * (where it went, how it travelled) become conditions on the transfer; sample / order
 * filters go through the same builder as the In-House list, under `where.sample`.
 */
describe('SampleTransferService.findTransfers - filters', () => {
  const findMany = jest.fn<
    Promise<unknown[]>,
    [{ where: Prisma.SampleTransferWhereInput }]
  >();
  const count = jest.fn<Promise<number>, []>();
  const labReportFindMany = jest.fn<
    Promise<unknown[]>,
    [{ where: Record<string, unknown> }]
  >();
  const orderSampleTestFindMany = jest.fn();
  const tx = {
    tenant: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ groupingMode: 'DEPARTMENT_SAMPLE_NAME' }),
    },
    sampleTransfer: { findMany, count },
    labReport: { findMany: labReportFindMany },
    orderSampleTest: { findMany: orderSampleTestFindMany },
  };
  const prisma = {
    withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const service = new SampleTransferService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );

  const whereFor = async (query: Partial<ListTransfersDto>) => {
    findMany.mockReset().mockResolvedValue([]);
    count.mockReset().mockResolvedValue(0);
    labReportFindMany.mockReset().mockResolvedValue([]);
    orderSampleTestFindMany.mockReset().mockResolvedValue([]);
    await service.findTransfers('t1', 'b1', query);
    return findMany.mock.calls[0]![0].where;
  };
  const andOf = (w: Prisma.SampleTransferWhereInput) =>
    (w.AND ?? []) as Prisma.SampleTransferWhereInput[];
  const sampleOf = (w: Prisma.SampleTransferWhereInput) =>
    (w.sample as { is: Prisma.OrderSampleWhereInput } | undefined)?.is;

  it('adds no sample condition and no extra transfer condition without filters (outgoing)', async () => {
    const w = await whereFor({ direction: 'outgoing' });
    expect(w.sample).toBeUndefined();
    expect(w.AND).toBeUndefined();
    expect(w.originBranchId).toBe('b1');
  });

  it('keeps the receiver-visibility rule for the incoming queue', async () => {
    const w = await whereFor({});
    expect(w.destinationBranchId).toBe('b1');
    expect(andOf(w)).toHaveLength(1);
    expect(JSON.stringify(andOf(w)[0])).toContain('NOT');
  });

  it('turns the transfer-level filters into transfer conditions', async () => {
    const w = await whereFor({
      direction: 'outgoing',
      originBranchId: 'o1',
      destinationBranchId: 'd1',
      outsourceCenterId: 'c1',
      externalPartnerName: ' Apollo_% ',
      logisticsPerson: 'ravi',
      sampleForm: 'whole',
    });
    const and = andOf(w);
    expect(and).toContainEqual({ originBranchId: 'o1' });
    expect(and).toContainEqual({ destinationBranchId: 'd1' });
    expect(and).toContainEqual({ outsourceCenterId: 'c1' });
    // typed text is literal: % and _ are escaped, not wildcards
    expect(and).toContainEqual({
      externalPartnerName: { contains: 'Apollo\\_\\%', mode: 'insensitive' },
    });
    expect(and).toContainEqual({
      logisticsPerson: { contains: 'ravi', mode: 'insensitive' },
    });
    expect(and).toContainEqual({
      sampleForm: { contains: 'whole', mode: 'insensitive' },
    });
    // the direction scope is untouched
    expect(w.originBranchId).toBe('b1');
    expect(w.sample).toBeUndefined();
  });

  it('search covers barcode, order id and patient fields - not the accession number', async () => {
    const w = await whereFor({ search: 'ord-1' });
    const s = sampleOf(w)!;
    const text = JSON.stringify(s);
    expect(text).not.toContain('accessionNo');
    expect(text).toContain('barcode');
    expect(text).toContain('orderCode');
    expect(text).toContain('umId');
    expect(text).toContain('mobile');
  });

  it('puts sample / order filters under the linked sample', async () => {
    const w = await whereFor({
      orderType: OrderType.WALK_IN,
      createdByUserId: 'u1',
      orderBranchId: 'ob1',
      isHomeVisit: true,
      referredByDoctorId: 'rd1',
      containerTypes: ['URINE_CONTAINER'],
      sampleNames: ['Serum-Plain'],
      sampleTypeNotSet: true,
    });
    const s = sampleOf(w)!;
    expect(s.containerType).toEqual({ in: ['URINE_CONTAINER'] });
    expect(s.order).toEqual({
      is: {
        orderType: OrderType.WALK_IN,
        createdBy: 'u1',
        branchId: 'ob1',
        referredByDoctorId: 'rd1',
        diagnostics: { is: { isHomeVisit: true } },
      },
    });
    const and = s.AND as Prisma.OrderSampleWhereInput[];
    expect(and).toContainEqual({ sampleName: { in: ['Serum-Plain'] } });
    expect(and).toContainEqual({
      OR: [{ sampleType: null }, { sampleType: '' }],
    });
  });

  it('department / lab test / lab panel filter through the order items, like In-House', async () => {
    const w = await whereFor({
      departmentId: 'd1',
      branchLabTestId: 't1',
      branchLabPanelId: 'p1',
    });
    expect(sampleOf(w)!.order).toEqual({
      is: {
        items: {
          some: {
            deletedAt: null,
            branchLabTestId: 't1',
            branchLabPanelId: 'p1',
            branchLabTest: { is: { departmentId: 'd1' } },
          },
        },
      },
    });
  });

  it('Order Creation Date is a plain inclusive day range on the order (date-only column)', async () => {
    const w = await whereFor({
      orderDateFrom: '2026-10-05',
      orderDateTo: '2026-10-06',
    });
    expect(sampleOf(w)!.order).toEqual({
      is: {
        orderDate: {
          gte: new Date('2026-10-05T00:00:00.000Z'),
          lte: new Date('2026-10-06T00:00:00.000Z'),
        },
      },
    });
    expect(w.sendDate).toBeUndefined();
  });

  it('keeps the send date on the transfer, apart from the order date', async () => {
    const w = await whereFor({
      dateFrom: '2026-10-05',
      dateTo: '2026-10-05',
      orderDateFrom: '2026-10-01',
    });
    expect(w.sendDate).toEqual({
      gte: new Date('2026-10-05T00:00:00.000Z'),
      lt: new Date('2026-10-06T00:00:00.000Z'),
    });
    expect(sampleOf(w)!.order).toEqual({
      is: { orderDate: { gte: new Date('2026-10-01T00:00:00.000Z') } },
    });
  });

  it('report status reads the reports of samples with a transfer in THIS queue (not just this branch)', async () => {
    labReportFindMany.mockReset().mockResolvedValue([]);
    await whereFor({
      direction: 'outgoing',
      kind: 'INTERNAL',
      reportStatus: LabReportStatus.PUBLISHED,
    });
    expect(labReportFindMany.mock.calls[0]![0].where).toMatchObject({
      status: LabReportStatus.PUBLISHED,
      orderItem: {
        orderSampleTests: {
          some: {
            sample: {
              is: {
                tenantId: 't1',
                deletedAt: null,
                transfers: {
                  some: {
                    deletedAt: null,
                    kind: 'INTERNAL',
                    originBranchId: 'b1',
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('a status with no matching report matches no transfer', async () => {
    const w = await whereFor({ reportStatus: LabReportStatus.SAVED });
    expect(
      (sampleOf(w)!.AND as Prisma.OrderSampleWhereInput[]) ?? [],
    ).toContainEqual({ id: { in: [] } });
  });

  it('the count uses the same condition as the list', async () => {
    await whereFor({ originBranchId: 'o1', orderType: OrderType.APP });
    expect(findMany.mock.calls[0]![0].where).toEqual(
      (count.mock.calls[0] as unknown as [{ where: unknown }])[0].where,
    );
  });
});
