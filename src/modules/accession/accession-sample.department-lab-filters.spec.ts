import { AccessionGroupingMode, Prisma, SampleStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OrderSampleService } from './accession-sample.service';
import { ListSamplesDto } from './dto/list-samples.dto';

/**
 * Accession → In-House Orders: the Department / Lab Test / Lab Panel filters.
 * They are independent (each decides whether an order qualifies), judged on samples,
 * and the Department filter follows the grouping mode. Applied by the shared
 * `buildSampleWhere`, so the summary (tabs + TAT cards) and the list follow them
 * identically - asserted here through `summary`.
 */
describe('OrderSampleService — Department / Lab Test / Lab Panel filters', () => {
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
  const tenantFind = jest.fn();
  const testFind = jest.fn();
  const panelFindFirst = jest.fn();
  const panelFindMany = jest.fn();
  const resolveScope = jest.fn();
  let service: OrderSampleService;

  const DEPT = '11111111-1111-4111-8111-111111111111';
  const TEST = '22222222-2222-4222-8222-222222222222';
  const PANEL = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    groupBy
      .mockReset()
      .mockResolvedValue([{ status: SampleStatus.NEW, _count: { _all: 1 } }]);
    count.mockReset().mockResolvedValue(0);
    tenantFind
      .mockReset()
      .mockResolvedValue({ groupingMode: AccessionGroupingMode.ORDER });
    testFind.mockReset().mockResolvedValue({ sourceLabTestId: 'src-test' });
    panelFindFirst
      .mockReset()
      .mockResolvedValue({ sourceLabPanelId: 'src-panel' });
    resolveScope.mockReset().mockResolvedValue([]);
    panelFindMany
      .mockReset()
      .mockResolvedValue([{ id: PANEL }, { id: 'other-list-copy' }]);
    const tx = {
      tenant: { findUnique: tenantFind },
      branchLabTest: { findFirst: testFind },
      branchLabPanel: { findFirst: panelFindFirst, findMany: panelFindMany },
    };
    service = new OrderSampleService(
      {
        orderSample: { groupBy, count },
        withTenant: (_t: string, fn: (t: unknown) => unknown) =>
          Promise.resolve(fn(tx)),
      } as never,
      settings as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      { resolveDepartmentIds: resolveScope } as never,
      {} as never,
    );
  });

  const whereFor = async (query: Partial<ListSamplesDto>) => {
    await service.summary('t1', 'b1', 'p1', query);
    return groupBy.mock.calls[0]![0].where;
  };
  const orderAnd = (w: Prisma.OrderSampleWhereInput) =>
    (w.order?.AND ?? []) as Prisma.OrderWhereInput[];
  const text = (v: unknown) => JSON.stringify(v);

  it('does no lookup and adds no clause when none of the three filters is set', async () => {
    const w = await whereFor({});
    expect(tenantFind).not.toHaveBeenCalled();
    expect(testFind).not.toHaveBeenCalled();
    expect(w.departmentId).toBeUndefined();
    expect(w.order).toBeUndefined();
  });

  describe('Department', () => {
    it('ORDER grouping: the order qualifies when ONE of its samples is in the department', async () => {
      const w = await whereFor({ departmentId: DEPT });
      expect(w.departmentId).toBeUndefined(); // samples of the order are not narrowed
      expect(orderAnd(w)).toEqual([
        {
          orderSamples: {
            some: {
              deletedAt: null,
              branchId: 'b1',
              departmentId: DEPT,
              AND: [{}], // unrestricted user: no scope narrowing
            },
          },
        },
      ]);
    });

    it('ORDER grouping: a restricted user only counts samples they may see', async () => {
      resolveScope.mockResolvedValue(['dept-a', 'dept-b']);
      const w = await whereFor({ departmentId: DEPT });
      expect(text(orderAnd(w))).toContain(
        '"AND":[{"OR":[{"departmentId":null},{"departmentId":{"in":["dept-a","dept-b"]}}]}]',
      );
      // and the row-level scope is still applied on top
      expect(text(w.AND)).toContain(
        '"departmentId":{"in":["dept-a","dept-b"]}',
      );
    });

    it.each([
      AccessionGroupingMode.DEPARTMENT,
      AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME,
      AccessionGroupingMode.SAMPLE_NAME,
    ])('%s grouping: matches the sample itself', async (mode) => {
      tenantFind.mockResolvedValue({ groupingMode: mode });
      const w = await whereFor({ departmentId: DEPT });
      expect(w.departmentId).toBe(DEPT);
      expect(orderAnd(w)).toEqual([]);
    });

    it('"No Department" means samples with no department (ORDER and the other modes)', async () => {
      const order = await whereFor({ departmentId: 'none' });
      expect(text(orderAnd(order))).toContain('"departmentId":null');
      groupBy.mockClear();
      tenantFind.mockResolvedValue({
        groupingMode: AccessionGroupingMode.DEPARTMENT,
      });
      const other = await whereFor({ departmentId: 'none' });
      expect(other.departmentId).toBeNull();
    });

    it('no longer reads the ordered test or its department', async () => {
      const w = await whereFor({ departmentId: DEPT });
      expect(text(w)).not.toContain('branchLabTest');
      expect(text(w)).not.toContain('"items"');
    });
  });

  describe('Lab Test', () => {
    it('keeps the direct-order check and adds "a sample serves the test" (panel members found)', async () => {
      const w = await whereFor({ branchLabTestId: TEST });
      expect(testFind).toHaveBeenCalledWith({
        where: { id: TEST, tenantId: 't1' },
        select: { sourceLabTestId: true },
      });
      const clause = orderAnd(w)[0] as { OR: Prisma.OrderWhereInput[] };
      expect(clause.OR).toHaveLength(2);
      expect(text(clause.OR[0])).toContain(`"branchLabTestId":"${TEST}"`);
      // ...and a copy of the same test from ANY price list (matched on the master id)
      expect(text(clause.OR[0])).toContain(
        '"branchLabTest":{"is":{"sourceLabTestId":"src-test"}}',
      );
      expect(text(clause.OR[1])).toContain('"labTestId":"src-test"');
      // a removed order line does not keep matching
      expect(text(clause.OR[1])).toContain('"orderItem":{"deletedAt":null}');
    });

    it('reads an id that is not a branch test as the master id itself', async () => {
      testFind.mockResolvedValue(null);
      const w = await whereFor({ branchLabTestId: TEST });
      expect(text(orderAnd(w))).toContain(`"labTestId":"${TEST}"`);
      expect(text(orderAnd(w))).toContain(`"sourceLabTestId":"${TEST}"`);
    });

    it('a branch test with no master test falls back to its own id for the direct check', async () => {
      testFind.mockResolvedValue({ sourceLabTestId: null });
      const w = await whereFor({ branchLabTestId: TEST });
      const clause = orderAnd(w)[0] as { OR: Prisma.OrderWhereInput[] };
      // the master id falls back to the id itself, so nothing is lost
      expect(text(clause.OR[0])).toContain(`"branchLabTestId":"${TEST}"`);
    });
  });

  describe('Lab Panel', () => {
    it('matches every price-list copy of the panel, the chosen one included', async () => {
      const w = await whereFor({ branchLabPanelId: PANEL });
      expect(panelFindMany).toHaveBeenCalledWith({
        where: {
          tenantId: 't1',
          branchId: 'b1',
          sourceLabPanelId: 'src-panel',
          deletedAt: null,
        },
        select: { id: true },
      });
      expect(orderAnd(w)).toEqual([
        {
          items: {
            some: {
              deletedAt: null,
              branchLabPanelId: { in: [PANEL, 'other-list-copy'] },
            },
          },
        },
      ]);
    });

    it('falls back to the exact id when the panel has no master panel', async () => {
      panelFindFirst.mockResolvedValue({ sourceLabPanelId: null });
      const w = await whereFor({ branchLabPanelId: PANEL });
      expect(panelFindMany).not.toHaveBeenCalled();
      expect(text(orderAnd(w))).toContain(`"in":["${PANEL}"]`);
    });
  });

  describe('departmentId validation', () => {
    const errorsFor = (departmentId: unknown) =>
      validateSync(plainToInstance(ListSamplesDto, { departmentId })).filter(
        (e) => e.property === 'departmentId',
      );

    it.each([DEPT, DEPT.toUpperCase(), 'none'])('accepts %s', (v) => {
      expect(errorsFor(v)).toHaveLength(0);
    });

    it.each(['xyz', 'None', 'NONE', ' none', 'none ', '', '11111111'])(
      'rejects %p',
      (v) => {
        expect(errorsFor(v).length).toBeGreaterThan(0);
      },
    );

    it('accepts no department filter at all', () => {
      expect(
        validateSync(plainToInstance(ListSamplesDto, {})).filter(
          (e) => e.property === 'departmentId',
        ),
      ).toHaveLength(0);
    });
  });

  describe('combined', () => {
    it('ANDs the filters independently - they need not match the same line or sample', async () => {
      const w = await whereFor({
        departmentId: DEPT,
        branchLabTestId: TEST,
        branchLabPanelId: PANEL,
      });
      expect(orderAnd(w)).toHaveLength(3);
    });

    it('keeps Collection Status in the same AND list', async () => {
      const w = await whereFor({
        departmentId: DEPT,
        collectionStatus: 'PARTIAL',
      });
      expect(orderAnd(w)).toHaveLength(2);
    });
  });
});
