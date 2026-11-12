import { Prisma } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import { ListTransfersDto } from './dto/list-transfers.dto';

/**
 * Internal / External / Outsourced queues - sorting. A plain column is sorted by Prisma before paging;
 * a name the row only holds as an id (department, branch, center) is resolved and sorted in the service
 * over every matching row, THEN paged, so page 2 continues page 1 of the sorted list.
 */
describe('SampleTransferService.findTransfers - sorting', () => {
  const findMany = jest.fn<Promise<unknown[]>, [Record<string, unknown>]>();
  const count = jest.fn<Promise<number>, []>();
  const branchFindMany = jest.fn<
    Promise<unknown[]>,
    [Record<string, unknown>]
  >();
  const centerFindMany = jest.fn<
    Promise<unknown[]>,
    [Record<string, unknown>]
  >();
  const deptFindMany = jest.fn<Promise<unknown[]>, [Record<string, unknown>]>();
  const tx = {
    tenant: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ groupingMode: 'DEPARTMENT_SAMPLE_NAME' }),
    },
    sampleTransfer: { findMany, count },
    branch: { findMany: branchFindMany },
    outsourceCenter: { findMany: centerFindMany },
    department: { findMany: deptFindMany },
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
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

  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
    count.mockReset().mockResolvedValue(0);
    branchFindMany.mockReset().mockResolvedValue([]);
    centerFindMany.mockReset().mockResolvedValue([]);
    deptFindMany.mockReset().mockResolvedValue([]);
  });

  /** Rows of the page query: the id, and the sample the Department step reads. */
  const pageRows = (...ids: string[]) =>
    ids.map((id) => ({ id, sample: { tests: [] } }));

  const list = (query: Partial<ListTransfersDto>) =>
    service.findTransfers('t1', 'b1', query);

  it('without sortBy the list is newest first with the id as tie-breaker', async () => {
    await list({});
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('a plain column is sorted by Prisma before paging (skip / take), with the direction', async () => {
    await list({ sortBy: 'barcode', sortOrder: 'desc', page: 3, limit: 10 });
    const args = findMany.mock.calls[0]![0] as {
      skip: number;
      take: number;
      orderBy: unknown[];
    };
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
    expect(args.orderBy[0]).toEqual({
      sample: { barcode: { sort: 'desc', nulls: 'last' } },
    });
    expect(count).toHaveBeenCalledTimes(1);
  });

  describe('a name only held as an id', () => {
    const t = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      originBranchId: null,
      destinationBranchId: null,
      outsourceCenterId: null,
      ...extra,
    });

    it('destination branch: sorts every matching transfer by the branch NAME, then loads only the page', async () => {
      // the ids query, then the page query
      findMany
        .mockResolvedValueOnce([
          t('t1', { destinationBranchId: 'bz' }),
          t('t2', { destinationBranchId: 'ba' }),
          t('t3'),
          t('t4', { destinationBranchId: 'bm' }),
        ])
        .mockResolvedValueOnce(pageRows('t2', 't4'));
      branchFindMany.mockResolvedValue([
        { id: 'bz', name: 'Zeta' },
        { id: 'ba', name: 'alpha' },
        { id: 'bm', name: 'Mid' },
      ]);

      const r = await list({
        sortBy: 'destinationBranch',
        sortOrder: 'asc',
        page: 1,
        limit: 2,
      });

      // page 1 = the first two by name: alpha (t2), Mid (t4); Zeta and the nameless t3 come after
      const pageQuery = findMany.mock.calls[1]![0] as {
        where: Prisma.SampleTransferWhereInput;
      };
      expect(pageQuery.where).toEqual({ id: { in: ['t2', 't4'] } });
      expect(r.data.map((x) => x.id)).toEqual(['t2', 't4']);
      expect(r.total).toBe(4);
    });

    it('page 2 continues the sorted list, a missing name is last, descending flips the names only', async () => {
      const all = [
        t('t1', { destinationBranchId: 'bz' }),
        t('t2', { destinationBranchId: 'ba' }),
        t('t3'),
        t('t4', { destinationBranchId: 'bm' }),
      ];
      findMany
        .mockResolvedValueOnce(all)
        .mockResolvedValueOnce(pageRows('t2', 't3'));
      branchFindMany.mockResolvedValue([
        { id: 'bz', name: 'Zeta' },
        { id: 'ba', name: 'alpha' },
        { id: 'bm', name: 'Mid' },
      ]);
      // ascending: alpha, Mid, Zeta, (none) -> page 2 of 2 = Zeta (t1), none (t3)
      await list({
        sortBy: 'destinationBranch',
        sortOrder: 'asc',
        page: 2,
        limit: 2,
      });
      expect((findMany.mock.calls[1]![0] as { where: unknown }).where).toEqual({
        id: { in: ['t1', 't3'] },
      });

      findMany.mockReset().mockResolvedValueOnce(all).mockResolvedValue([]);
      // descending: Zeta, Mid, alpha, (none)
      await list({
        sortBy: 'destinationBranch',
        sortOrder: 'desc',
        page: 1,
        limit: 4,
      });
      expect((findMany.mock.calls[1]![0] as { where: unknown }).where).toEqual({
        id: { in: ['t1', 't4', 't2', 't3'] },
      });
    });

    it('outsource center reads the center table, origin branch the branch table', async () => {
      findMany
        .mockResolvedValueOnce([t('t1', { outsourceCenterId: 'c1' })])
        .mockResolvedValueOnce([]);
      centerFindMany.mockResolvedValue([{ id: 'c1', name: 'Lab X' }]);
      await list({ sortBy: 'outsourceCenter' });
      expect(centerFindMany).toHaveBeenCalledTimes(1);
      expect(branchFindMany).not.toHaveBeenCalled();
      expect(centerFindMany.mock.calls[0]![0]).toMatchObject({
        where: { id: { in: ['c1'] }, tenantId: 't1' },
      });

      findMany.mockReset();
      findMany
        .mockResolvedValueOnce([t('t1', { originBranchId: 'b9' })])
        .mockResolvedValueOnce([]);
      branchFindMany.mockResolvedValue([{ id: 'b9', name: 'Nine' }]);
      await list({ sortBy: 'originBranch' });
      expect(branchFindMany.mock.calls[0]![0]).toMatchObject({
        where: { id: { in: ['b9'] }, tenantId: 't1' },
      });
    });

    it('department sorts by the same text the column shows (distinct names joined)', async () => {
      const test = (deptId: string | null) => ({
        orderItem: {
          branchLabTest: { departmentId: deptId },
          branchLabPanel: null,
        },
      });
      findMany
        .mockResolvedValueOnce([
          { id: 't1', sample: { tests: [test('dB')] } },
          { id: 't2', sample: { tests: [test('dA'), test('dB')] } },
          { id: 't3', sample: { tests: [test(null)] } },
        ])
        .mockResolvedValueOnce([]);
      deptFindMany.mockResolvedValue([
        { id: 'dA', name: 'Biochemistry' },
        { id: 'dB', name: 'Pathology' },
      ]);
      await list({ sortBy: 'department', sortOrder: 'asc' });
      // "Biochemistry, Pathology" < "Pathology" < (none)
      expect((findMany.mock.calls[1]![0] as { where: unknown }).where).toEqual({
        id: { in: ['t2', 't1', 't3'] },
      });
    });

    it('the filters still apply to the id query', async () => {
      findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await list({
        direction: 'outgoing',
        kind: 'OUTSOURCE',
        sortBy: 'outsourceCenter',
      });
      expect(findMany.mock.calls[0]![0]).toMatchObject({
        where: { tenantId: 't1', kind: 'OUTSOURCE', originBranchId: 'b1' },
      });
    });
  });
});
