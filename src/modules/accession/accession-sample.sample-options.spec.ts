import { Prisma } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';

/**
 * `GET /accession/order-samples/sample-options` - the Sample Name / Sample Type filter
 * choices: scope (this branch's samples + samples moved to / from it), the column read,
 * and the paging / "Not set" shape around `buildSampleOptions` (merging is covered by
 * its own spec).
 */
describe('OrderSampleService.sampleOptions', () => {
  const groupBy = jest.fn<
    Promise<unknown[]>,
    [{ by: string[]; where: Prisma.OrderSampleWhereInput }]
  >();
  let service: OrderSampleService;

  beforeEach(() => {
    groupBy.mockReset();
    service = new OrderSampleService(
      { orderSample: { groupBy } } as never,
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
  });

  it('reads the sample name column for field=name, scoped to this branch or its transfers', async () => {
    groupBy.mockResolvedValue([]);
    await service.sampleOptions('t1', 'b1', { field: 'name' });
    const args = groupBy.mock.calls[0]![0];
    expect(args.by).toEqual(['sampleName']);
    expect(args.where).toEqual({
      tenantId: 't1',
      deletedAt: null,
      OR: [
        { branchId: 'b1' },
        {
          transfers: {
            some: {
              deletedAt: null,
              OR: [{ originBranchId: 'b1' }, { destinationBranchId: 'b1' }],
            },
          },
        },
      ],
    });
  });

  it('reads the sample type column for field=type', async () => {
    groupBy.mockResolvedValue([]);
    await service.sampleOptions('t1', 'b1', { field: 'type' });
    expect(groupBy.mock.calls[0]![0].by).toEqual(['sampleType']);
  });

  it('has no branch condition for a caller without an active branch', async () => {
    groupBy.mockResolvedValue([]);
    await service.sampleOptions('t1', null, { field: 'name' });
    expect(groupBy.mock.calls[0]![0].where).toEqual({
      tenantId: 't1',
      deletedAt: null,
    });
  });

  it('returns the entries paginated, with the Not set count and the total', async () => {
    groupBy.mockResolvedValue([
      { sampleName: null, _count: { _all: 4 } },
      { sampleName: 'Stool', _count: { _all: 1 } },
      { sampleName: 'Saliva', _count: { _all: 2 } },
      { sampleName: 'X-Ray', _count: { _all: 3 } },
    ]);
    const page1 = await service.sampleOptions('t1', 'b1', {
      field: 'name',
      page: 1,
      limit: 2,
    });
    expect(page1.notSetCount).toBe(4);
    expect(page1.total).toBe(3);
    expect(page1.data.map((o) => o.label)).toEqual(['Saliva', 'Stool']);

    const page2 = await service.sampleOptions('t1', 'b1', {
      field: 'name',
      page: 2,
      limit: 2,
    });
    expect(page2.data.map((o) => o.label)).toEqual(['X-Ray']);
  });
});
