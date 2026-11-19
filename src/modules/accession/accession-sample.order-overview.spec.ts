import { LabReportStatus, OrderStatus, SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import { OrderNotFoundException } from '../order/exceptions/order.exceptions';

/**
 * The read-only Order Overview behind the In-House list's Order ID. It must show the SAME rows the
 * list shows for the order (same branch, same department visibility), each with its report status,
 * where a sent sample is now, and the report the notes hang on.
 */
describe('OrderSampleService.findOrderOverview', () => {
  const settings = {
    resolve: jest.fn().mockResolvedValue({
      Accession_MaximumTimeToAcceptSampleMinutes: 100,
      Accession_WarningThresholdMinutes: 60,
      Accession_CriticalThresholdMinutes: 30,
    }),
  };
  const orderFindFirst = jest.fn();
  const sampleFindMany = jest.fn<
    Promise<unknown[]>,
    [{ where: Record<string, unknown> & { AND?: unknown } }]
  >();
  const reportFindMany = jest.fn();
  const transferFindMany = jest.fn();
  const branchFindMany = jest.fn();
  const deptFindMany = jest.fn();
  type Link = { orderItemId: string; labTestId: string | null };
  /** sample id -> its (order line, test) links - what the loader reads from orderSampleTest */
  const links = new Map<string, Link[]>();
  const linkFindMany = jest.fn(
    (args: { where: { sampleId: { in: string[] } } }) =>
      Promise.resolve(
        args.where.sampleId.in.flatMap((id) =>
          (links.get(id) ?? []).map((l) => ({ sampleId: id, ...l })),
        ),
      ),
  );
  /** Queue the list rows and register their links (and any extra, e.g. a copy's). */
  const listRows = (
    rows: ReturnType<typeof row>[],
    extra: Record<string, Link[]> = {},
  ) => {
    rows.forEach((r) =>
      links.set(
        r.id,
        r.tests.map((t) => ({
          orderItemId: t.orderItemId,
          labTestId: t.labTestId,
        })),
      ),
    );
    Object.entries(extra).forEach(([id, l]) => links.set(id, l));
    sampleFindMany.mockResolvedValueOnce(rows);
  };
  const tx = {
    order: { findFirst: orderFindFirst },
    orderSample: { findMany: sampleFindMany },
    labReport: { findMany: reportFindMany },
    sampleTransfer: { findMany: transferFindMany },
    branch: { findMany: branchFindMany },
    department: { findMany: deptFindMany },
    orderSampleTest: { findMany: linkFindMany },
    outsourceCenter: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx),
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const scope = { resolveDepartmentIds: jest.fn() };
  let service: OrderSampleService;

  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    accessionNo: `ACC-${id}`,
    status: SampleStatus.ACCEPTED,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    departmentId: 'dA',
    transfers: [],
    tests: [
      { orderItemId: `i-${id}`, labTestId: `t-${id}`, testName: `Test ${id}` },
    ],
    ...over,
  });
  const report = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    status: LabReportStatus.SAVED,
    branchId: 'b1',
    orderItemId: `i-${id.replace('r', 's')}`,
    labTestId: null,
    memberBranchLabTestId: null,
    ...over,
  });

  beforeEach(() => {
    links.clear();
    for (const m of [
      orderFindFirst,
      sampleFindMany,
      reportFindMany,
      transferFindMany,
      branchFindMany,
      deptFindMany,
    ]) {
      m.mockReset();
    }
    orderFindFirst.mockResolvedValue({
      id: 'o1',
      orderCode: 'ORD-1',
      status: OrderStatus.ORDER,
    });
    sampleFindMany.mockResolvedValue([]);
    reportFindMany.mockResolvedValue([]);
    transferFindMany.mockResolvedValue([]);
    branchFindMany.mockResolvedValue([]);
    deptFindMany.mockResolvedValue([{ id: 'dA', name: 'Biochemistry' }]);
    scope.resolveDepartmentIds.mockReset().mockResolvedValue([]);
    service = new OrderSampleService(
      prisma as never,
      settings as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      scope as never,
      {} as never,
    );
  });

  const overview = () => service.findOrderOverview('t1', 'b1', 'p1', 'o1');

  it('an order that does not exist is a 404', async () => {
    orderFindFirst.mockResolvedValue(null);
    await expect(overview()).rejects.toBeInstanceOf(OrderNotFoundException);
  });

  it("reads exactly the list's rows: this branch, this order, not deleted, visible departments only", async () => {
    await overview();
    expect(sampleFindMany.mock.calls[0]![0].where).toEqual({
      tenantId: 't1',
      branchId: 'b1',
      orderId: 'o1',
      deletedAt: null,
      // a user mapped to no department is UNRESTRICTED on the In-House list (same rule as
      // `departmentScopeForSamples`, which the popup reuses), so the scope adds no constraint
      AND: [{}],
    });

    scope.resolveDepartmentIds.mockResolvedValue(['dA', 'dB']);
    sampleFindMany.mockClear();
    await overview();
    expect(sampleFindMany.mock.calls[0]![0].where.AND).toEqual([
      { OR: [{ departmentId: null }, { departmentId: { in: ['dA', 'dB'] } }] },
    ]);
  });

  it('gives each test its name, department, report status and whether this branch holds the report', async () => {
    listRows([row('s1'), row('s2', { departmentId: null })]);
    reportFindMany.mockResolvedValue([
      report('r1', { status: LabReportStatus.APPROVED }),
      report('r2', { branchId: 'b2' }),
    ]);
    branchFindMany.mockResolvedValue([{ id: 'b2', name: 'Branch B' }]);

    const o = await overview();

    expect(o.orderCode).toBe('ORD-1');
    expect(o.tests.map((t) => t.testName)).toEqual(['Test s1', 'Test s2']);
    expect(o.tests[0]!.department).toBe('Biochemistry');
    expect(o.tests[1]!.department).toBeNull();
    expect(o.tests[0]!.report).toEqual({
      id: 'r1',
      status: LabReportStatus.APPROVED,
      heldHere: true,
      heldAtBranchName: null,
    });
    expect(o.tests[1]!.report).toMatchObject({
      id: 'r2',
      heldHere: false,
      heldAtBranchName: 'Branch B',
    });
  });

  it('a test with no report yet has report null (nothing accepted)', async () => {
    listRows([row('s1')]);
    const o = await overview();
    expect(o.tests[0]!.report).toBeNull();
    expect(o.notesReportId).toBeNull();
  });

  it('the notes anchor is the first report held at THIS branch, null when it holds none', async () => {
    listRows([row('s1'), row('s2')]);
    reportFindMany.mockResolvedValue([
      report('r1', { branchId: 'b2' }),
      report('r2', { branchId: 'b1' }),
    ]);
    expect((await overview()).notesReportId).toBe('r2');

    listRows([row('s1')]);
    reportFindMany.mockResolvedValue([report('r1', { branchId: 'b2' })]);
    expect((await overview()).notesReportId).toBeNull();
  });

  it('a sample this branch sent on shows where it is now ("Currently at Branch B: Accepted")', async () => {
    sampleFindMany
      .mockResolvedValueOnce([
        row('s1', { status: SampleStatus.SENT_INTERNAL }),
        row('s2'),
      ])
      .mockResolvedValueOnce([
        { id: 'c1', status: SampleStatus.ACCEPTED, branchId: 'b2' },
      ]);
    transferFindMany
      .mockResolvedValueOnce([{ sampleId: 's1', clonedSampleId: 'c1' }])
      .mockResolvedValue([]);
    branchFindMany.mockResolvedValue([{ id: 'b2', name: 'Branch B' }]);

    const o = await overview();

    expect(o.tests[0]!.holder).toEqual({
      branchId: 'b2',
      branchName: 'Branch B',
      status: SampleStatus.ACCEPTED,
    });
    expect(o.tests[1]!.holder).toBeNull();
    // the row keeps THIS branch's own status - the list's "Sent" - never the holder's
    expect(o.tests[0]!.sample.status).toBe(SampleStatus.SENT_INTERNAL);
  });

  it('follows a sample sent on again to the last copy', async () => {
    sampleFindMany
      .mockResolvedValueOnce([
        row('s1', { status: SampleStatus.SENT_INTERNAL }),
      ])
      .mockResolvedValueOnce([
        { id: 'c2', status: SampleStatus.COLLECTED, branchId: 'b3' },
      ]);
    transferFindMany
      .mockResolvedValueOnce([{ sampleId: 's1', clonedSampleId: 'c1' }])
      .mockResolvedValueOnce([{ sampleId: 'c1', clonedSampleId: 'c2' }])
      .mockResolvedValue([]);
    branchFindMany.mockResolvedValue([{ id: 'b3', name: 'Branch C' }]);
    expect((await overview()).tests[0]!.holder).toMatchObject({
      branchName: 'Branch C',
      status: SampleStatus.COLLECTED,
    });
  });

  it("a panel member sent on still shows its report: the report follows the test to the receiver's own copy", async () => {
    // s1 carries the sender's test (tOld); its accepted copy c1 carries the receiver's (tNew), and the
    // member report points at tNew - so the sender's sample alone would never find it.
    listRows(
      [
        row('s1', {
          status: SampleStatus.SENT_INTERNAL,
          tests: [
            { orderItemId: 'i1', labTestId: 'tOld', testName: 'Test s1' },
          ],
        }),
      ],
      { c1: [{ orderItemId: 'i1', labTestId: 'tNew' }] },
    );
    sampleFindMany.mockResolvedValueOnce([
      { id: 'c1', status: SampleStatus.ACCEPTED, branchId: 'b2' },
    ]);
    transferFindMany
      .mockResolvedValueOnce([{ sampleId: 's1', clonedSampleId: 'c1' }])
      .mockResolvedValue([]);
    reportFindMany.mockResolvedValue([
      report('r-m', {
        status: LabReportStatus.APPROVED,
        branchId: 'b2',
        orderItemId: 'i1',
        labTestId: 'tNew',
        memberBranchLabTestId: 'm1',
      }),
    ]);
    branchFindMany.mockResolvedValue([{ id: 'b2', name: 'Branch B' }]);

    const o = await overview();

    expect(o.tests[0]!.report).toMatchObject({
      id: 'r-m',
      status: LabReportStatus.APPROVED,
      heldHere: false,
      heldAtBranchName: 'Branch B',
    });
  });

  it('marks a cancelled order, and reads nothing for another branch (the where is this branch only)', async () => {
    orderFindFirst.mockResolvedValue({
      id: 'o1',
      orderCode: 'ORD-1',
      status: OrderStatus.CANCELLED,
    });
    const o = await overview();
    expect(o.orderCancelled).toBe(true);
    expect(o.tests).toEqual([]);
  });
});
