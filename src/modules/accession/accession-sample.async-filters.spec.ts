import { LabReportStatus, Prisma, SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import { ListSamplesDto } from './dto/list-samples.dto';

/**
 * In-House filters that need an extra query before the list query: report status
 * (a panel member's sample must match ITS OWN report) and category / subcategory
 * (a sample only keeps its test's id). They are applied by the shared
 * `buildScopedWhere`, asserted here through `summary` so the tabs and the list
 * follow them identically.
 */
describe('OrderSampleService — report status and category filters', () => {
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
  const labReportFindMany = jest.fn();
  const orderSampleTestFindMany = jest.fn();
  const labTestFindMany = jest.fn();
  const branchLabTestFindMany = jest.fn();
  const orderFindMany = jest.fn();
  const transferFindMany = jest.fn();
  const panelTestFindMany = jest.fn();
  const tx = {
    order: { findMany: orderFindMany },
    sampleTransfer: { findMany: transferFindMany },
    branchLabPanelTest: { findMany: panelTestFindMany },
    labReport: { findMany: labReportFindMany },
    orderSampleTest: { findMany: orderSampleTestFindMany },
    labTest: { findMany: labTestFindMany },
    branchLabTest: { findMany: branchLabTestFindMany },
  };
  const withTenant = jest.fn(
    async (_tenantId: string, cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  );
  let service: OrderSampleService;
  /** The `where` of the first call to a Prisma `findMany` mock. */
  const firstWhere = (mock: jest.Mock): Record<string, unknown> =>
    (mock.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;

  beforeEach(() => {
    groupBy
      .mockReset()
      .mockResolvedValue([{ status: SampleStatus.NEW, _count: { _all: 1 } }]);
    count.mockReset().mockResolvedValue(0);
    for (const m of [
      labReportFindMany,
      orderSampleTestFindMany,
      labTestFindMany,
      branchLabTestFindMany,
      orderFindMany,
      panelTestFindMany,
      withTenant,
    ]) {
      m.mockClear();
    }
    orderSampleTestFindMany.mockReset();
    transferFindMany.mockReset().mockResolvedValue([]);
    service = new OrderSampleService(
      { orderSample: { groupBy, count }, withTenant } as never,
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
    w.AND as Prisma.OrderSampleWhereInput[];

  describe('report status', () => {
    type Link = { orderItemId: string; labTestId: string | null };
    /** The two orderSampleTest queries: the candidates (by order line) and the links of a set of samples. */
    const mockLinks = (candidates: string[], links: Record<string, Link[]>) => {
      orderSampleTestFindMany.mockImplementation(
        (args: {
          where: { orderItemId?: unknown; sampleId?: { in: string[] } };
        }) =>
          Promise.resolve(
            args.where.orderItemId
              ? candidates.map((sampleId) => ({ sampleId }))
              : (args.where.sampleId?.in ?? []).flatMap((id) =>
                  (links[id] ?? []).map((l) => ({ sampleId: id, ...l })),
                ),
          ),
      );
    };
    const rep = (over: Record<string, unknown> = {}) => ({
      id: 'r',
      status: LabReportStatus.SAVED,
      branchId: 'b1',
      orderItemId: 'i1',
      labTestId: null,
      memberBranchLabTestId: null,
      ...over,
    });

    it("reads this branch's reports with that status, then the samples on those order lines", async () => {
      labReportFindMany.mockResolvedValue([rep()]);
      mockLinks(['s1'], { s1: [{ orderItemId: 'i1', labTestId: 't1' }] });

      const w = await whereFor({ reportStatus: LabReportStatus.SAVED });

      expect(firstWhere(labReportFindMany)).toMatchObject({
        tenantId: 't1',
        deletedAt: null,
        status: LabReportStatus.SAVED,
        orderItem: {
          orderSampleTests: {
            some: {
              sample: {
                is: { tenantId: 't1', branchId: 'b1', deletedAt: null },
              },
            },
          },
        },
      });
      expect(firstWhere(orderSampleTestFindMany)).toMatchObject({
        orderItemId: { in: ['i1'] },
        sample: { is: { tenantId: 't1', branchId: 'b1', deletedAt: null } },
      });
      expect(andOf(w)).toContainEqual({ id: { in: ['s1'] } });
    });

    it('a whole-test report belongs to every sample of that order line', async () => {
      labReportFindMany.mockResolvedValue([rep()]);
      mockLinks(['s1', 's2'], {
        s1: [{ orderItemId: 'i1', labTestId: 't1' }],
        s2: [{ orderItemId: 'i1', labTestId: 't2' }],
      });
      const w = await whereFor({ reportStatus: LabReportStatus.SAVED });
      expect(andOf(w)).toContainEqual({ id: { in: ['s1', 's2'] } });
    });

    it("a panel member's sample matches only ITS OWN report, not a sibling's", async () => {
      labReportFindMany.mockResolvedValue([
        rep({
          orderItemId: 'i2',
          labTestId: 'tA',
          memberBranchLabTestId: 'm1',
        }),
      ]);
      mockLinks(['s1', 's2'], {
        s1: [{ orderItemId: 'i2', labTestId: 'tA' }],
        s2: [{ orderItemId: 'i2', labTestId: 'tB' }],
      });
      const w = await whereFor({ reportStatus: LabReportStatus.SAVED });
      expect(andOf(w)).toContainEqual({ id: { in: ['s1'] } });
    });

    it("a panel member sample that was SENT is found through its copy (the report was re-pointed at the receiver's own test)", async () => {
      // s1 (this branch, sent) carries the sender's test; c1 (the accepted copy) carries the receiver's
      // test, and the report - a member report - points at the receiver's test.
      labReportFindMany.mockResolvedValue([
        rep({
          orderItemId: 'i2',
          labTestId: 'tNew',
          memberBranchLabTestId: 'm1',
          branchId: 'b2',
        }),
      ]);
      mockLinks(['s1'], {
        s1: [{ orderItemId: 'i2', labTestId: 'tOld' }],
        c1: [{ orderItemId: 'i2', labTestId: 'tNew' }],
      });
      transferFindMany.mockResolvedValueOnce([
        { sampleId: 's1', clonedSampleId: 'c1' },
      ]);
      const w = await whereFor({ reportStatus: LabReportStatus.SAVED });
      expect(andOf(w)).toContainEqual({ id: { in: ['s1'] } });
    });

    it('matches nothing when no report has that status (and skips the other queries)', async () => {
      labReportFindMany.mockResolvedValue([]);
      const w = await whereFor({ reportStatus: LabReportStatus.PUBLISHED });
      expect(orderSampleTestFindMany).not.toHaveBeenCalled();
      expect(andOf(w)).toContainEqual({ id: { in: [] } });
    });

    it('matches nothing when no sample sits on a reported order line', async () => {
      labReportFindMany.mockResolvedValue([rep()]);
      mockLinks([], {});
      const w = await whereFor({ reportStatus: LabReportStatus.SAVED });
      expect(andOf(w)).toContainEqual({ id: { in: [] } });
    });
  });

  describe('category / subcategory', () => {
    it('keeps the samples of tests that the tenant test OR a branch copy puts in the category', async () => {
      labTestFindMany.mockResolvedValue([{ id: 't1' }]);
      branchLabTestFindMany.mockResolvedValue([
        { sourceLabTestId: 't1' },
        { sourceLabTestId: 't2' },
      ]);

      const w = await whereFor({ categoryId: 'c1', subCategoryId: 'sc1' });

      const classification = { categoryId: 'c1', subCategoryId: 'sc1' };
      expect(firstWhere(labTestFindMany)).toMatchObject({
        tenantId: 't1',
        deletedAt: null,
        ...classification,
      });
      expect(firstWhere(branchLabTestFindMany)).toMatchObject({
        tenantId: 't1',
        deletedAt: null,
        sourceLabTestId: { not: null },
        ...classification,
      });
      expect(andOf(w)).toContainEqual({ labTestId: { in: ['t1', 't2'] } });
    });

    it('a category with no tests matches nothing', async () => {
      labTestFindMany.mockResolvedValue([]);
      branchLabTestFindMany.mockResolvedValue([]);
      const w = await whereFor({ categoryId: 'c-empty' });
      expect(andOf(w)).toContainEqual({ labTestId: { in: [] } });
    });
  });

  describe('order status (roll-up)', () => {
    const item = (statuses: string[], panelId?: string, billOnly = false) => ({
      branchLabTest: panelId ? null : { isBillOnlyTest: billOnly },
      branchLabPanel: panelId ? { id: panelId, isBillOnlyTest: false } : null,
      labReports: statuses.map((status) => ({
        status,
        memberBranchLabTestId: panelId ? 'm' : null,
      })),
    });

    it('keeps the orders whose derived status matches, scanning only orders with a sample at this branch', async () => {
      orderFindMany.mockResolvedValue([
        { id: 'o-done', items: [item(['APPROVED']), item(['PUBLISHED'])] },
        { id: 'o-half', items: [item(['RESULT_DONE']), item(['PENDING'])] },
        { id: 'o-none', items: [item(['PENDING'])] },
      ]);

      const w = await whereFor({ orderStatus: 'PARTIALLY_COMPLETED' });

      expect(firstWhere(orderFindMany)).toMatchObject({
        tenantId: 't1',
        deletedAt: null,
        orderSamples: {
          some: { tenantId: 't1', branchId: 'b1', deletedAt: null },
        },
      });
      expect(andOf(w)).toContainEqual({ orderId: { in: ['o-half'] } });
    });

    it('a panel with members not yet accepted keeps the order below Completed (uses the real member count)', async () => {
      orderFindMany.mockResolvedValue([
        { id: 'o-panel', items: [item(['RESULT_DONE'], 'p1')] },
      ]);
      panelTestFindMany.mockResolvedValue([
        { branchLabPanelId: 'p1' },
        { branchLabPanelId: 'p1' },
        { branchLabPanelId: 'p1' },
      ]);

      const done = await whereFor({ orderStatus: 'COMPLETED' });
      expect(andOf(done)).toContainEqual({ orderId: { in: [] } });

      groupBy.mockClear();
      const partial = await whereFor({ orderStatus: 'PARTIALLY_COMPLETED' });
      expect(andOf(partial)).toContainEqual({ orderId: { in: ['o-panel'] } });
    });

    it('leaves bill-only items out of the derivation', async () => {
      orderFindMany.mockResolvedValue([
        {
          id: 'o1',
          items: [item(['APPROVED']), item([], undefined, true)],
        },
      ]);
      const w = await whereFor({ orderStatus: 'APPROVED' });
      expect(andOf(w)).toContainEqual({ orderId: { in: ['o1'] } });
    });
  });

  it('runs no extra query when neither filter is used', async () => {
    const w = await whereFor({ search: 'x' });
    expect(withTenant).not.toHaveBeenCalled();
    expect(JSON.stringify(w)).not.toContain('labTestId');
  });
});
