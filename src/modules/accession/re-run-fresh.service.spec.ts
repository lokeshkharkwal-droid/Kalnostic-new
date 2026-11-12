import {
  LabReportStatus,
  ReRunSampleMode,
  SampleStatus,
  TransferStatus,
} from '@prisma/client';
import { ReRunFreshService } from './re-run-fresh.service';
import { ReRunFreshNotAllowedException } from './exceptions/accession.exceptions';
import { LabReportNotFoundException } from '../lab-report/exceptions/lab-report.exceptions';

/**
 * Re-run with a fresh sample.
 *  - the pop-up lists the tests that share the clicked test's tube, each with whether it can be re-run (and why not);
 *  - the re-run is all-or-nothing and runs in one transaction, in order: lock, wipe, record, send the tubes back;
 *  - an in-house tube goes to Repeat and loses its old barcode (Collect makes the new one); a received copy goes back to the sender; an outsourced tube's
 *    outsource transfer is closed as Repeat and the sample stays Outsourced.
 */
const T = 't1';
const B = 'branch-A';
const P = 'person-1';

interface ReportFx {
  id: string;
  status: LabReportStatus;
  isLocked?: boolean;
  orderId?: string;
  orderStatus?: string;
  itemDeleted?: boolean;
  name?: string;
  member?: string | null;
  labTestId?: string | null;
  branchId?: string;
}
interface TubeFx {
  id: string;
  itemId: string;
  status?: SampleStatus;
  barcode?: string | null;
  sourceTransferId?: string | null;
  orderId?: string;
  testCount?: number;
}

const report = (id: string, over: Partial<ReportFx> = {}): ReportFx => ({
  id,
  status: LabReportStatus.RESULT_DONE,
  ...over,
});
const tube = (
  id: string,
  itemId: string,
  over: Partial<TubeFx> = {},
): TubeFx => ({
  id,
  itemId,
  status: SampleStatus.ACCEPTED,
  barcode: '10001',
  sourceTransferId: null,
  ...over,
});

function build(reports: ReportFx[], tubes: TubeFx[]) {
  const order: string[] = [];
  const rows = (r: ReportFx) => ({
    id: r.id,
    status: r.status,
    isLocked: r.isLocked ?? false,
    branchId: r.branchId ?? B,
    orderItemId: `item-${r.id}`,
    memberBranchLabTestId: r.member ?? null,
    labTestId: r.labTestId ?? null,
    orderItem: {
      id: `item-${r.id}`,
      deletedAt: r.itemDeleted ? new Date() : null,
      order: {
        id: r.orderId ?? 'o1',
        orderCode: 'ORD-1',
        status: r.orderStatus ?? 'ORDER',
      },
      branchLabTest: { testName: r.name ?? `Test ${r.id}` },
      branchLabPanel: null,
      direct: null,
    },
  });
  const tubeRow = (t: TubeFx) => ({
    id: t.id,
    status: t.status,
    barcode: t.barcode,
    branchId: B,
    orderId: t.orderId ?? 'o1',
    sourceTransferId: t.sourceTransferId,
    tests: Array.from({ length: t.testCount ?? 1 }, (_, i) => ({
      id: `l${i}`,
    })),
  });
  const reportRows = reports.map(rows);

  const tx = {
    labReport: {
      findFirst: jest
        .fn()
        .mockImplementation((a: { where: { id: string; branchId: string } }) =>
          Promise.resolve(
            reportRows.find(
              (r) => r.id === a.where.id && r.branchId === a.where.branchId,
            ) ?? null,
          ),
        ),
      findMany: jest.fn().mockImplementation(
        (a: {
          where: {
            id?: { in: string[] };
            orderItemId?: { in: string[] };
            branchId: string;
          };
        }) =>
          Promise.resolve(
            reportRows.filter(
              (r) =>
                r.branchId === a.where.branchId &&
                (a.where.id
                  ? a.where.id.in.includes(r.id)
                  : (a.where.orderItemId?.in ?? []).includes(r.orderItemId)),
            ),
          ),
      ),
    },
    orderSample: {
      updateMany: jest.fn().mockImplementation(() => {
        order.push('clear-barcode');
        return Promise.resolve({ count: 1 });
      }),
      findMany: jest.fn().mockImplementation(
        (a: {
          where: {
            id?: { in: string[] };
            barcode?: string;
            tests?: { some: { orderItemId: string } };
          };
        }) => {
          if (a.where.id) {
            return Promise.resolve(
              tubes
                .filter((t) => a.where.id!.in.includes(t.id))
                .map((t) => ({
                  id: t.id,
                  branchId: B,
                  orderId: t.orderId ?? 'o1',
                })),
            );
          }
          if (a.where.barcode) {
            return Promise.resolve(
              tubes
                .filter((t) => t.barcode === a.where.barcode)
                .map((t) => ({
                  tests: [{ orderItemId: t.itemId, labTestId: null }],
                })),
            );
          }
          const itemId = a.where.tests!.some.orderItemId;
          return Promise.resolve(
            tubes.filter((t) => t.itemId === itemId).map(tubeRow),
          );
        },
      ),
    },
    reRunRequest: {
      create: jest.fn().mockImplementation(() => {
        order.push('request');
        return Promise.resolve({});
      }),
    },
    sampleTransfer: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({ id: 'tr-out' }),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ groupingMode: 'ORDER' }),
    },
    orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    orderSampleUpdateMany: jest.fn(),
  };
  (tx as Record<string, unknown>).orderSampleTest = {
    findMany: jest.fn().mockResolvedValue([]),
  };

  const prisma = {
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const samples = {
    assertSamplesInDepartmentScope: jest.fn().mockResolvedValue(undefined),
    // the pop-up asks which tubes are outside the caller's departments: none (an unrestricted caller)
    findSamplesOutsideDepartmentScope: jest.fn().mockResolvedValue([]),
    transitionInTx: jest.fn().mockImplementation(() => {
      order.push('transition');
      return Promise.resolve({});
    }),
    returnCopyToOrigin: jest.fn().mockImplementation(() => {
      order.push('return-copy');
      return Promise.resolve('origin-1');
    }),
    recordNoteInTx: jest.fn().mockResolvedValue(undefined),
  };
  const labReports = {
    lockReports: jest.fn().mockImplementation(() => {
      order.push('lock');
      return Promise.resolve();
    }),
    resetReportsForReturn: jest.fn().mockImplementation(() => {
      order.push('wipe');
      return Promise.resolve();
    }),
    recordFreshRerunInTx: jest.fn().mockImplementation(() => {
      order.push('history');
      return Promise.resolve();
    }),
  };
  const emitAsync = jest.fn().mockResolvedValue(undefined);
  const service = new ReRunFreshService(
    prisma as never,
    samples as never,
    labReports as never,
    { emitAsync } as never,
    {
      resolve: jest.fn().mockResolvedValue({
        MasterData_RepeatReasons: ['Hemolysed', 'Clotted'],
      }),
    } as never,
  );
  const run = (
    ids: string[],
    over: { repeatReason?: string; notes?: string } = {},
  ) =>
    service.rerunFresh(T, B, P, {
      reportIds: ids,
      repeatReason: 'Hemolysed',
      ...over,
    });
  return {
    service,
    tx,
    prisma,
    samples,
    labReports,
    emitAsync,
    order,
    run,
  };
}

const refusal = async (p: Promise<unknown>) =>
  (await p.catch((e: unknown) => e)) as ReRunFreshNotAllowedException;

describe('ReRunFreshService.eligibility (the pop-up)', () => {
  it('lists the tests that share the clicked test’s barcode, the clicked one first', async () => {
    const m = build(
      [report('r1'), report('r2', { status: LabReportStatus.APPROVED })],
      [tube('s1', 'item-r1'), tube('s2', 'item-r2')],
    );
    const res = await m.service.eligibility(T, B, 'r1');
    expect(res.barcode).toBe('10001');
    expect(res.tests.map((x) => x.reportId)).toEqual(['r1', 'r2']);
    expect(res.tests[0]).toMatchObject({
      isClicked: true,
      eligible: true,
      reason: null,
      kind: 'IN_HOUSE',
    });
    expect(res.tests[1]).toMatchObject({ isClicked: false, eligible: false });
    expect(res.tests[1]!.reason).toContain(
      'Result Done, Result Rejected or Error Reported',
    );
  });

  it('a caller limited to some departments: a same-barcode test of ANOTHER department is listed but greyed out ("not in your department"), the clicked test stays eligible', async () => {
    const m = build(
      [report('r1'), report('r2', { name: 'Other department test' })],
      [tube('s1', 'item-r1'), tube('s2', 'item-r2')],
    );
    m.samples.findSamplesOutsideDepartmentScope.mockImplementation(
      (_t: string, _p: string | null, ids: string[]) => Promise.resolve(ids.filter((id) => id === 's2')),
    );
    const res = await m.service.eligibility(T, B, 'r1', P);
    expect(res.tests.map((x) => [x.reportId, x.eligible, x.reason])).toEqual([
      ['r1', true, null],
      ['r2', false, 'This test is not in your department.'],
    ]);
    expect(res.tests[1]!.kind).toBeNull();
    // asked for the acting person, with the tubes of each test
    expect(m.samples.findSamplesOutsideDepartmentScope).toHaveBeenCalledWith(T, P, ['s2']);
  });

  it('a clicked report that is itself outside the caller’s departments is "not found" (nothing about it is revealed)', async () => {
    const m = build([report('r1')], [tube('s1', 'item-r1')]);
    m.samples.findSamplesOutsideDepartmentScope.mockResolvedValue(['s1']);
    await expect(m.service.eligibility(T, B, 'r1', P)).rejects.toBeInstanceOf(LabReportNotFoundException);
  });

  it('an unrestricted caller sees every test exactly as before (no person id needed either)', async () => {
    const m = build(
      [report('r1'), report('r2')],
      [tube('s1', 'item-r1'), tube('s2', 'item-r2')],
    );
    const res = await m.service.eligibility(T, B, 'r1');
    expect(res.tests.map((x) => x.eligible)).toEqual([true, true]);
  });

  it('returns the branch’s configured repeat reasons for the reason dropdown', async () => {
    const m = build([report('r1')], [tube('s1', 'item-r1')]);
    const res = await m.service.eligibility(T, B, 'r1');
    expect(res.repeatReasons).toEqual(['Hemolysed', 'Clotted']);
  });

  it('a test whose tube has no barcode yet is listed alone', async () => {
    const m = build(
      [report('r1'), report('r2')],
      [
        tube('s1', 'item-r1', { barcode: null }),
        tube('s2', 'item-r2', { barcode: null }),
      ],
    );
    const res = await m.service.eligibility(T, B, 'r1');
    expect(res.tests.map((x) => x.reportId)).toEqual(['r1']);
  });

  it('a report that is not at the caller’s branch is not found', async () => {
    const m = build(
      [report('r1', { branchId: 'other' })],
      [tube('s1', 'item-r1')],
    );
    await expect(m.service.eligibility(T, B, 'r1')).rejects.toBeInstanceOf(
      LabReportNotFoundException,
    );
  });

  it.each([
    [
      'the report is Approved',
      { r: { status: LabReportStatus.APPROVED } },
      'Result Done, Result Rejected',
    ],
    [
      'the report is Published',
      { r: { status: LabReportStatus.PUBLISHED } },
      'Result Done, Result Rejected',
    ],
    [
      'the report is Validation Pending',
      { r: { status: LabReportStatus.VALIDATION_PENDING } },
      'Result Done, Result Rejected',
    ],
    ['the report is locked', { r: { isLocked: true } }, 'locked'],
    [
      'the order is cancelled',
      { r: { orderStatus: 'CANCELLED' } },
      'order is cancelled',
    ],
    [
      'the test was removed',
      { r: { itemDeleted: true } },
      'removed from the order',
    ],
    [
      'the sample is only Collected',
      { t: { status: SampleStatus.COLLECTED } },
      'must be Accepted',
    ],
    [
      'the sample is on Hold',
      { t: { status: SampleStatus.HOLD } },
      'must be Accepted',
    ],
    [
      'the sample is Stored',
      { t: { status: SampleStatus.STORED } },
      'must be Accepted',
    ],
    [
      'the sample was sent to another branch',
      { t: { status: SampleStatus.SENT_INTERNAL } },
      'sent to another branch',
    ],
    [
      'the sample was forwarded',
      { t: { status: SampleStatus.FORWARD_EXTERNAL } },
      'must be Accepted',
    ],
    [
      'the sample carries more than one test',
      { t: { testCount: 2 } },
      'more than one test',
    ],
  ] as [string, { r?: Partial<ReportFx>; t?: Partial<TubeFx> }, string][])(
    'is not eligible when %s',
    async (_name, over, reasonPart) => {
      const m = build([report('r1', over.r)], [tube('s1', 'item-r1', over.t)]);
      const res = await m.service.eligibility(T, B, 'r1');
      expect(res.tests[0]!.eligible).toBe(false);
      expect(res.tests[0]!.reason).toContain(reasonPart);
      expect(res.tests[0]!.kind).toBeNull();
    },
  );

  it.each([
    [LabReportStatus.RESULT_DONE],
    [LabReportStatus.RESULT_REJECTED],
    [LabReportStatus.ERROR_REPORTED],
  ])('is eligible from %s', async (status) => {
    const m = build([report('r1', { status })], [tube('s1', 'item-r1')]);
    expect((await m.service.eligibility(T, B, 'r1')).tests[0]!.eligible).toBe(
      true,
    );
  });

  it('tells the kind: a received copy and an outsourced tube', async () => {
    const copy = build(
      [report('r1')],
      [tube('s1', 'item-r1', { sourceTransferId: 'tr1' })],
    );
    expect((await copy.service.eligibility(T, B, 'r1')).tests[0]!.kind).toBe(
      'COPY',
    );
    const out = build(
      [report('r1')],
      [tube('s1', 'item-r1', { status: SampleStatus.OUTSOURCED })],
    );
    expect((await out.service.eligibility(T, B, 'r1')).tests[0]!.kind).toBe(
      'OUTSOURCED',
    );
  });

  it('a test with two tubes in different places is not eligible', async () => {
    const m = build(
      [report('r1')],
      [
        tube('s1', 'item-r1'),
        tube('s2', 'item-r1', { status: SampleStatus.OUTSOURCED }),
      ],
    );
    const res = await m.service.eligibility(T, B, 'r1');
    expect(res.tests[0]!.eligible).toBe(false);
    expect(res.tests[0]!.reason).toContain('different places');
  });
});

describe('ReRunFreshService.rerunFresh — an in-house tube', () => {
  it('locks, wipes, records, sends the tube to Repeat and clears its old barcode, in that order', async () => {
    const m = build([report('r1')], [tube('s1', 'item-r1')]);
    const res = await m.run(['r1'], { notes: 'looks clotted' });
    expect(m.order).toEqual([
      'lock',
      'wipe',
      'history',
      'request',
      'transition',
      'clear-barcode',
    ]);
    expect(m.labReports.lockReports).toHaveBeenCalledWith(
      expect.anything(),
      T,
      ['r1'],
    );
    expect(m.labReports.resetReportsForReturn).toHaveBeenCalledWith(
      expect.anything(),
      T,
      ['r1'],
      P,
    );
    expect(m.samples.transitionInTx).toHaveBeenCalledWith(
      expect.anything(),
      T,
      P,
      's1',
      'repeat',
      expect.any(Function),
      { notes: 'Re-run with fresh sample: looks clotted', freshRerun: true },
    );
    expect(res.items).toEqual([
      { reportId: 'r1', kind: 'IN_HOUSE', sampleIds: ['s1'], barcode: null },
    ]);
  });

  it('records a FRESH Re-run request tied to the batch of the repeated rows', async () => {
    const m = build([report('r1')], [tube('s1', 'item-r1')]);
    const res = await m.run(['r1']);
    expect(m.tx.reRunRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        labReportId: 'r1',
        branchId: B,
        requestedBy: P,
        sampleMode: ReRunSampleMode.FRESH,
        repeatBatchId: res.batchId,
      }) as Record<string, unknown>,
    });
  });

  it('the repeat reason is the transition reason and is written with the history line', async () => {
    const m = build(
      [report('r1', { status: LabReportStatus.ERROR_REPORTED })],
      [tube('s1', 'item-r1')],
    );
    await m.run(['r1']);
    const build1 = (
      m.samples.transitionInTx.mock.calls[0] as unknown[]
    )[5] as () => { reason: string };
    expect(build1().reason).toBe('Hemolysed');
    expect(m.labReports.recordFreshRerunInTx).toHaveBeenCalledWith(
      expect.anything(),
      T,
      'r1',
      LabReportStatus.ERROR_REPORTED,
      P,
      'Re-run with fresh sample (reason: Hemolysed)',
    );
  });

  it('tests re-run together: one batch, both tubes repeated in id order, one batch tag, one panel event each', async () => {
    const m = build(
      [report('r2'), report('r1')],
      [tube('s2', 'item-r2'), tube('s1', 'item-r1')],
    );
    const res = await m.run(['r2', 'r1']);
    expect(m.labReports.lockReports).toHaveBeenCalledWith(
      expect.anything(),
      T,
      ['r1', 'r2'],
    );
    expect(
      m.samples.transitionInTx.mock.calls.map((c) => (c as unknown[])[3]),
    ).toEqual(['s1', 's2']);
    // the old barcode comes off both tubes in ONE write, with one shared batch tag; Collect makes the new barcode
    expect(m.tx.orderSample.updateMany).toHaveBeenCalledTimes(1);
    const call = m.tx.orderSample.updateMany.mock.calls[0] as [
      { where: { id: { in: string[] }; tenantId: string }; data: unknown },
    ];
    expect([...call[0].where.id.in].sort()).toEqual(['s1', 's2']);
    expect(call[0].data).toEqual(
      expect.objectContaining({
        barcode: null,
        orderIdBarcode: null,
        repeatBatchId: res.batchId,
      }),
    );
    expect(res.items.every((i) => i.barcode === null)).toBe(true);
    expect(m.emitAsync).toHaveBeenCalledTimes(2);
    expect(m.emitAsync).toHaveBeenCalledWith(
      'accession.sample.repeat',
      expect.objectContaining({ tenantId: T, orderId: 'o1' }),
    );
  });

  it('checks the department scope on the tubes first', async () => {
    const m = build([report('r1')], [tube('s1', 'item-r1')]);
    await m.run(['r1']);
    expect(m.samples.assertSamplesInDepartmentScope).toHaveBeenCalledWith(
      T,
      P,
      ['s1'],
    );
  });

  it('a department refusal stops everything: nothing is wiped or moved', async () => {
    const m = build([report('r1')], [tube('s1', 'item-r1')]);
    m.samples.assertSamplesInDepartmentScope.mockRejectedValue(
      new Error('out of scope'),
    );
    await expect(m.run(['r1'])).rejects.toThrow('out of scope');
    expect(m.labReports.resetReportsForReturn).not.toHaveBeenCalled();
    expect(m.samples.transitionInTx).not.toHaveBeenCalled();
  });
});

describe('ReRunFreshService.rerunFresh — refusals change nothing', () => {
  const nothingChanged = (m: ReturnType<typeof build>) => {
    expect(m.labReports.resetReportsForReturn).not.toHaveBeenCalled();
    expect(m.labReports.recordFreshRerunInTx).not.toHaveBeenCalled();
    expect(m.tx.reRunRequest.create).not.toHaveBeenCalled();
    expect(m.samples.transitionInTx).not.toHaveBeenCalled();
    expect(m.samples.returnCopyToOrigin).not.toHaveBeenCalled();
    expect(m.tx.orderSample.updateMany).not.toHaveBeenCalled();
    expect(m.emitAsync).not.toHaveBeenCalled();
  };

  it('one ineligible test refuses the whole request (all or nothing), naming the test', async () => {
    const m = build(
      [
        report('r1'),
        report('r2', { status: LabReportStatus.APPROVED, name: 'Creatinine' }),
      ],
      [tube('s1', 'item-r1'), tube('s2', 'item-r2')],
    );
    const e = await refusal(m.run(['r1', 'r2']));
    expect(e).toBeInstanceOf(ReRunFreshNotAllowedException);
    expect(e).toMatchObject({ errorCode: 'RERUN_FRESH_NOT_ALLOWED' });
    expect(
      (e.getResponse() as { error: { message: string } }).error.message,
    ).toContain('Creatinine');
    nothingChanged(m);
  });

  it('tests of two orders are refused', async () => {
    const m = build(
      [report('r1'), report('r2', { orderId: 'o2' })],
      [tube('s1', 'item-r1'), tube('s2', 'item-r2', { orderId: 'o2' })],
    );
    const e = await refusal(m.run(['r1', 'r2']));
    expect(
      (e.getResponse() as { error: { message: string } }).error.message,
    ).toContain('one order');
    nothingChanged(m);
  });

  it('a report of another branch is not found and nothing is touched', async () => {
    const m = build(
      [report('r1', { branchId: 'other' })],
      [tube('s1', 'item-r1')],
    );
    await expect(m.run(['r1'])).rejects.toBeInstanceOf(
      LabReportNotFoundException,
    );
    nothingChanged(m);
  });

  it('a blank repeat reason is refused', async () => {
    const m = build([report('r1')], [tube('s1', 'item-r1')]);
    const e = await refusal(m.run(['r1'], { repeatReason: '   ' }));
    expect(
      (e.getResponse() as { error: { message: string } }).error.message,
    ).toContain('reason');
    nothingChanged(m);
  });

  it.each([
    LabReportStatus.PENDING,
    LabReportStatus.SAVED,
    LabReportStatus.VALIDATION_PENDING,
    LabReportStatus.APPROVED,
    LabReportStatus.PUBLISHED,
  ])('a %s report is refused', async (status) => {
    const m = build([report('r1', { status })], [tube('s1', 'item-r1')]);
    await expect(m.run(['r1'])).rejects.toBeInstanceOf(
      ReRunFreshNotAllowedException,
    );
    nothingChanged(m);
  });

  it('a report approved after the first read (a race) is refused once the rows are locked', async () => {
    const m = build([report('r1')], [tube('s1', 'item-r1')]);
    // first read (pre-check) sees Result Done; the read inside the transaction, after the lock, sees Approved
    const original = m.tx.labReport.findMany.getMockImplementation()!;
    let calls = 0;
    m.tx.labReport.findMany.mockImplementation((a: never) => {
      calls += 1;
      return (original(a) as Promise<{ status: LabReportStatus }[]>).then(
        (rows) =>
          calls === 1
            ? rows
            : rows.map((r) => ({ ...r, status: LabReportStatus.APPROVED })),
      );
    });
    await expect(m.run(['r1'])).rejects.toBeInstanceOf(
      ReRunFreshNotAllowedException,
    );
    nothingChanged(m);
  });

  it('a locked report, a cancelled order and a removed test are refused', async () => {
    for (const over of [
      { isLocked: true },
      { orderStatus: 'CANCELLED' },
      { itemDeleted: true },
    ]) {
      const m = build([report('r1', over)], [tube('s1', 'item-r1')]);
      await expect(m.run(['r1'])).rejects.toBeInstanceOf(
        ReRunFreshNotAllowedException,
      );
      nothingChanged(m);
    }
  });

  it.each([
    SampleStatus.NEW,
    SampleStatus.COLLECTED,
    SampleStatus.HOLD,
    SampleStatus.REPEAT,
    SampleStatus.STORED,
    SampleStatus.RETURNED,
    SampleStatus.DISCARDED,
    SampleStatus.CANCELLED,
    SampleStatus.SENT_INTERNAL,
    SampleStatus.FORWARD_EXTERNAL,
  ])('a %s sample is refused', async (status) => {
    const m = build([report('r1')], [tube('s1', 'item-r1', { status })]);
    await expect(m.run(['r1'])).rejects.toBeInstanceOf(
      ReRunFreshNotAllowedException,
    );
    nothingChanged(m);
  });
});

describe('ReRunFreshService.rerunFresh — a tube received from another branch', () => {
  it('is sent back to the sender, the transfer is closed as Repeat, and no new barcode is made here', async () => {
    const m = build(
      [report('r1')],
      [tube('s1', 'item-r1', { sourceTransferId: 'tr1' })],
    );
    const res = await m.run(['r1']);
    expect(m.order).toEqual([
      'lock',
      'wipe',
      'history',
      'return-copy',
      'request', // after the copy is returned: that return resets the report again and would clear an earlier request
    ]);
    expect(m.samples.returnCopyToOrigin).toHaveBeenCalledWith(
      expect.anything(),
      T,
      P,
      's1',
      'Hemolysed',
      'repeat',
    );
    expect(m.tx.sampleTransfer.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'tr1',
        tenantId: T,
        deletedAt: null,
        transferStatus: TransferStatus.ACCEPTED,
      },
      data: {
        transferStatus: TransferStatus.REPEAT,
        repeatReason: 'Hemolysed',
        updatedBy: P,
      },
    });
    expect(m.samples.transitionInTx).not.toHaveBeenCalled();
    expect(m.tx.orderSample.updateMany).not.toHaveBeenCalled();
    expect(res.items[0]).toMatchObject({ kind: 'COPY', barcode: null });
    // the panel is told when the sender confirms the Repeat, as for a normal send-back
    expect(m.emitAsync).not.toHaveBeenCalled();
  });

  it('a Result Done report on the copy is allowed (it is wiped first, so the send-back sees a clean report)', async () => {
    const m = build(
      [report('r1', { status: LabReportStatus.RESULT_DONE })],
      [tube('s1', 'item-r1', { sourceTransferId: 'tr1' })],
    );
    await m.run(['r1']);
    expect(m.order.indexOf('wipe')).toBeLessThan(
      m.order.indexOf('return-copy'),
    );
  });
});

describe('ReRunFreshService.rerunFresh — an outsourced tube', () => {
  it('closes the outsource transfer as Repeat; the sample stays Outsourced; no new barcode; a history note', async () => {
    const m = build(
      [report('r1')],
      [tube('s1', 'item-r1', { status: SampleStatus.OUTSOURCED })],
    );
    const res = await m.run(['r1']);
    expect(m.tx.sampleTransfer.update).toHaveBeenCalledWith({
      where: { id: 'tr-out' },
      data: {
        transferStatus: TransferStatus.REPEAT,
        repeatReason: 'Hemolysed',
        updatedBy: P,
      },
    });
    expect(m.samples.transitionInTx).not.toHaveBeenCalled();
    expect(m.tx.orderSample.updateMany).not.toHaveBeenCalled();
    expect(m.samples.recordNoteInTx).toHaveBeenCalledWith(
      expect.anything(),
      T,
      P,
      's1',
      're-run-fresh',
      expect.objectContaining({
        notes: expect.stringContaining(
          'outsource transfer is closed as Repeat',
        ) as string,
      }),
    );
    expect(res.items[0]).toMatchObject({ kind: 'OUTSOURCED', barcode: null });
  });

  it('an outsourced sample with no outsource transfer is refused', async () => {
    const m = build(
      [report('r1')],
      [tube('s1', 'item-r1', { status: SampleStatus.OUTSOURCED })],
    );
    m.tx.sampleTransfer.findFirst.mockResolvedValue(null);
    await expect(m.run(['r1'])).rejects.toBeInstanceOf(
      ReRunFreshNotAllowedException,
    );
  });
});

describe('ReRunFreshService.rerunFresh — mixed tests of one order', () => {
  it('an in-house tube, a received copy and an outsourced tube are each sent the right way in one request', async () => {
    const m = build(
      [report('r1'), report('r2'), report('r3')],
      [
        tube('s1', 'item-r1'),
        tube('s2', 'item-r2', { sourceTransferId: 'tr2' }),
        tube('s3', 'item-r3', { status: SampleStatus.OUTSOURCED }),
      ],
    );
    const res = await m.run(['r1', 'r2', 'r3']);
    expect(res.items.map((i) => i.kind)).toEqual([
      'IN_HOUSE',
      'COPY',
      'OUTSOURCED',
    ]);
    expect(m.samples.transitionInTx).toHaveBeenCalledTimes(1);
    expect(m.samples.returnCopyToOrigin).toHaveBeenCalledTimes(1);
    expect(m.tx.sampleTransfer.update).toHaveBeenCalledTimes(1);
    expect(m.tx.orderSample.updateMany).toHaveBeenCalledTimes(1); // only the in-house tube loses its barcode
  });
});
