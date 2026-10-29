import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  InvalidSampleTransitionException,
  SampleBarcodeLockedException,
  SampleOrderCancelledException,
} from './exceptions/accession.exceptions';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { BarcodeService } from './barcode.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { AppointmentService } from '../appointment/appointment.service';

/** First argument of a mock's first call, typed (avoids `any` member access in assertions). */
const firstCallArg = (m: jest.Mock): unknown => {
  const calls = m.mock.calls as unknown[][];
  return calls[0]?.[0];
};

/**
 * Unit coverage for the panel sample-resolution helpers (all private, exercised
 * via an `as unknown` cast — see auth.service.spec.ts for the same pattern).
 *
 * A panel order item has no `branchLabTest` of its own, so `generateForOrderInTx`
 * expands it into its constituent tests (`panelConstituentTests`) and resolves
 * each test's required samples (`samplesForTest` → `samplesOf`), producing one
 * `OrderSample` per (test × sample). These guard the query filters (`deletedAt`)
 * and the live-rows/snapshot fallback that feed that expansion.
 */
describe('OrderSampleService — panel sample resolution', () => {
  const txMock = {
    branchLabPanelTest: { findMany: jest.fn() },
    branchLabTest: { findMany: jest.fn() },
    labTestSample: { findMany: jest.fn() },
  };

  let service: OrderSampleService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrderSampleService(
      {} as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
      {} as unknown as AppointmentService,
    );
  });

  // ── panelConstituentTests ──────────────────────────────────────────────────

  /** Calls the private `panelConstituentTests` without touching its modifier. */
  const panelConstituentTests = (branchLabPanelId: string) =>
    (
      service as unknown as {
        panelConstituentTests: (
          tx: typeof txMock,
          tenantId: string,
          branchLabPanelId: string,
        ) => Promise<
          Array<{ sourceLabTestId: string | null; testName: string | null }>
        >;
      }
    ).panelConstituentTests(txMock, 't1', branchLabPanelId);

  /** The `where` clause of the most recent `branchLabPanelTest.findMany()` call. */
  const lastPanelTestWhere = (): { deletedAt: unknown } => {
    const calls = txMock.branchLabPanelTest.findMany.mock
      .calls as unknown as Array<[{ where: { deletedAt: unknown } }]>;
    const last = calls[calls.length - 1];
    if (!last) throw new Error('branchLabPanelTest.findMany was not called');
    return last[0].where;
  };

  /** The `where` clause of the most recent `branchLabTest.findMany()` call. */
  const lastLabTestWhere = (): { deletedAt: unknown } => {
    const calls = txMock.branchLabTest.findMany.mock.calls as unknown as Array<
      [{ where: { deletedAt: unknown } }]
    >;
    const last = calls[calls.length - 1];
    if (!last) throw new Error('branchLabTest.findMany was not called');
    return last[0].where;
  };

  it("returns the panel's constituent tests", async () => {
    txMock.branchLabPanelTest.findMany.mockResolvedValue([
      { branchLabTestId: 'test-cbc' },
    ]);
    const tests = [
      {
        testName: 'CBC',
        departmentId: 'dep-1',
        sourceLabTestId: 'src-cbc',
        configSnapshot: { samples: [], resultParams: [] },
      },
    ];
    txMock.branchLabTest.findMany.mockResolvedValue(tests);

    const result = await panelConstituentTests('panel-1');

    expect(result).toEqual(tests);
  });

  it('excludes soft-deleted panel-test links (deletedAt filter passed to the query)', async () => {
    txMock.branchLabPanelTest.findMany.mockResolvedValue([]);

    await panelConstituentTests('panel-1');

    expect(lastPanelTestWhere().deletedAt).toBeNull();
  });

  it('excludes soft-deleted BranchLabTest rows (deletedAt filter passed to the query)', async () => {
    txMock.branchLabPanelTest.findMany.mockResolvedValue([
      { branchLabTestId: 'test-a' },
    ]);
    txMock.branchLabTest.findMany.mockResolvedValue([]);

    await panelConstituentTests('panel-1');

    expect(lastLabTestWhere().deletedAt).toBeNull();
  });

  it('returns an empty list and skips the test query when the panel has no active links', async () => {
    txMock.branchLabPanelTest.findMany.mockResolvedValue([]);

    const result = await panelConstituentTests('panel-1');

    expect(result).toEqual([]);
    expect(txMock.branchLabTest.findMany).not.toHaveBeenCalled();
  });

  // ── samplesForTest / samplesOf ─────────────────────────────────────────────

  /** Calls the private `samplesForTest` without touching its modifier. */
  const samplesForTest = (sourceLabTestId: string | null, snapshot: unknown) =>
    (
      service as unknown as {
        samplesForTest: (
          tx: typeof txMock,
          tenantId: string,
          sourceLabTestId: string | null,
          snapshot: unknown,
        ) => Promise<Array<{ sampleType?: string; containerType?: string }>>;
      }
    ).samplesForTest(txMock, 't1', sourceLabTestId, snapshot);

  const snapshotWith = (
    samples: Array<{ sampleType: string; containerType: string }>,
  ) => ({ samples, resultParams: [] });

  it('reads the live LabTestSample rows for the source test (deletedAt filtered)', async () => {
    const live = [
      { id: 's1', sampleType: 'Blood', containerType: 'EDTA_TUBE_PURPLE_TOP' },
    ];
    txMock.labTestSample.findMany.mockResolvedValue(live);

    const result = await samplesForTest(
      'src-cbc',
      snapshotWith([
        { sampleType: 'Serum', containerType: 'PLAIN_TUBE_RED_TOP' },
      ]),
    );

    expect(result).toEqual(live);
    const calls = txMock.labTestSample.findMany.mock.calls as unknown as Array<
      [{ where: { deletedAt: unknown } }]
    >;
    expect(calls[0]?.[0].where.deletedAt).toBeNull();
  });

  it('falls back to configSnapshot.samples when there are no live rows', async () => {
    txMock.labTestSample.findMany.mockResolvedValue([]);
    const snapSamples = [
      { sampleType: 'Serum', containerType: 'PLAIN_TUBE_RED_TOP' },
    ];

    const result = await samplesForTest('src-cbc', snapshotWith(snapSamples));

    expect(result).toEqual(snapSamples);
  });

  it('uses the snapshot directly when there is no source test id', async () => {
    const snapSamples = [
      { sampleType: 'Blood', containerType: 'EDTA_TUBE_PURPLE_TOP' },
    ];

    const result = await samplesForTest(null, snapshotWith(snapSamples));

    expect(result).toEqual(snapSamples);
    expect(txMock.labTestSample.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty list when neither live rows nor snapshot samples exist', async () => {
    txMock.labTestSample.findMany.mockResolvedValue([]);

    expect(await samplesForTest('src-cbc', {})).toEqual([]);
    expect(await samplesForTest('src-cbc', undefined)).toEqual([]);
    expect(await samplesForTest(null, undefined)).toEqual([]);
  });
});

describe('OrderSampleService — reconcileForOrderInTx (remove path)', () => {
  function makeService() {
    return new OrderSampleService(
      {} as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
      {} as unknown as AppointmentService,
    );
  }

  it('voids a sample linked only to removed items and drops shared links', async () => {
    const transferUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const now = new Date('2026-09-11T00:00:00Z');
    const tx = {
      orderSample: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'S1', tests: [{ id: 'l1', orderItemId: 'R1' }] },
          {
            id: 'S2',
            tests: [
              { id: 'l2', orderItemId: 'R1' },
              { id: 'l3', orderItemId: 'K1' },
            ],
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      orderSampleTest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // the extra "does a removed item have a report?" read: none here
      labReport: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      sampleTransfer: { updateMany: transferUpdateMany },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as import('@prisma/client').Prisma.TransactionClient;

    const service = makeService();
    await (
      service as unknown as {
        reconcileForOrderInTx: (
          tx: unknown,
          t: string,
          b: string | null,
          p: string | null,
          o: string,
          opts: { addedItemIds: string[]; removedItemIds: string[]; now: Date },
        ) => Promise<void>;
      }
    ).reconcileForOrderInTx(tx, 'ten1', 'br1', 'per1', 'ord1', {
      addedItemIds: [],
      removedItemIds: ['R1'],
      now,
    });

    // S1 exclusive to R1 -> voided (soft-deleted + CANCELLED)
    expect(tx.orderSample.update as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'S1' },
        data: expect.objectContaining({ deletedAt: now, status: 'CANCELLED' }),
      }),
    );
    // S1's open transfer (on its way, or already ACCEPTED with a copy at the receiver)
    // is closed - not left dangling for the receiver - and its copy link is cleared
    expect(transferUpdateMany).toHaveBeenCalledTimes(1);
    expect(firstCallArg(transferUpdateMany)).toMatchObject({
      where: {
        sampleId: 'S1',
        transferStatus: {
          in: ['IN_TRANSIT', 'PICKED_UP', 'RECEIVED', 'ACCEPTED'],
        },
      },
      data: {
        transferStatus: 'REJECTED',
        rejectionReason: 'Order item removed',
        clonedSampleId: null,
      },
    });
    // S2 shared -> NOT voided
    expect(tx.orderSample.update as jest.Mock).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'S2' } }),
    );
    // OrderSampleTest has deletedAt -> soft-delete the removed link (l2)
    expect(tx.orderSampleTest.updateMany as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['l2'] } },
        data: expect.objectContaining({ deletedAt: now }),
      }),
    );
    // removed items' reports soft-deleted (scoped to the removed items + tenant)
    expect(tx.labReport.updateMany as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderItemId: { in: ['R1'] },
          tenantId: 'ten1',
          deletedAt: null,
        }),
        data: expect.objectContaining({ deletedAt: now }),
      }),
    );
  });

  it('generates samples for added items and touches nothing on the remove side', async () => {
    const now = new Date('2026-09-11T00:00:00Z');
    const addedItems = [
      { id: 'A1', branchLabTest: { id: 'blt1' }, branchLabPanel: null },
    ];
    const tx = {
      orderSample: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      orderSampleTest: { updateMany: jest.fn(), deleteMany: jest.fn() },
      labReport: { updateMany: jest.fn() },
      orderItem: { findMany: jest.fn().mockResolvedValue(addedItems) },
    } as unknown as import('@prisma/client').Prisma.TransactionClient;

    const service = makeService();
    // Stub the (already-tested) sample builder so this test isolates the ADD branch.
    const buildSpy = jest
      .spyOn(
        service as unknown as {
          buildSamplesForItems: (...a: unknown[]) => Promise<void>;
        },
        'buildSamplesForItems',
      )
      .mockResolvedValue(undefined);

    await (
      service as unknown as {
        reconcileForOrderInTx: (
          tx: unknown,
          t: string,
          b: string | null,
          p: string | null,
          o: string,
          opts: { addedItemIds: string[]; removedItemIds: string[]; now: Date },
        ) => Promise<void>;
      }
    ).reconcileForOrderInTx(tx, 'ten1', 'br1', 'per1', 'ord1', {
      addedItemIds: ['A1'],
      removedItemIds: [],
      now,
    });

    // ADD path loads the added items (scoped) and builds their samples.
    expect(tx.orderItem.findMany as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['A1'] },
          orderId: 'ord1',
          tenantId: 'ten1',
          deletedAt: null,
        }),
      }),
    );
    expect(buildSpy).toHaveBeenCalledWith(
      tx,
      'ten1',
      'br1',
      'per1',
      'ord1',
      addedItems,
    );
    // No removals -> remove-side writes untouched.
    expect(tx.orderSample.findMany as jest.Mock).not.toHaveBeenCalled();
    expect(tx.orderSample.update as jest.Mock).not.toHaveBeenCalled();
    expect(tx.labReport.updateMany as jest.Mock).not.toHaveBeenCalled();
  });
});

/**
 * `{patient_age}` on sample labels (`order_label_print` /
 * `multiple_order_label_print`, both built by the private `buildLabelVariables`)
 * is a single-unit age from DOB — not the full "Y Years, M Months, D Days"
 * breakdown the order documents print.
 */
describe('OrderSampleService — label variables', () => {
  const service = new OrderSampleService(
    {} as unknown as PrismaService,
    {} as unknown as AccessionSettingsService,
    {} as unknown as LabReportService,
    {} as unknown as PdfReportTemplateService,
    {} as unknown as PdfTemplateConfigService,
    {} as unknown as EventEmitter2,
    {} as unknown as TenantService,
    {} as unknown as BarcodeService,
    {} as unknown as UserDepartmentScopeService,
    {} as unknown as AppointmentService,
  );

  /** `patient_age` of a label for a patient with this DOB / age snapshot. */
  const labelAge = (
    dateOfBirth: string | null,
    age: number | null = null,
    ageType: string | null = null,
  ) =>
    (
      service as unknown as {
        buildLabelVariables: (
          sample: unknown,
          timezone: string,
          dateFormat: string,
          timeFormat: string,
        ) => Record<string, unknown>;
      }
    ).buildLabelVariables(
      {
        accessionNo: 'ACC-1',
        tests: [],
        collectedAt: null,
        order: {
          orderCode: 'ORD-1',
          patient: {
            firstName: 'Test',
            dateOfBirth: dateOfBirth
              ? new Date(`${dateOfBirth}T00:00:00Z`)
              : null,
            age,
            ageType,
          },
        },
      },
      'Asia/Kolkata',
      'DD/MM/YYYY',
      '12h',
    ).patient_age;

  beforeEach(() => {
    jest.useFakeTimers();
    // 2026-09-25 01:30 IST — still the 24th in UTC.
    jest.setSystemTime(new Date('2026-09-24T20:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('prints Years, Months or Days by the patient’s age', () => {
    expect(labelAge('2001-12-12')).toBe('24 Years');
    expect(labelAge('2026-03-20')).toBe('6 Months');
    expect(labelAge('2026-09-10')).toBe('15 Days');
  });

  it('prefers the DOB over a stale age snapshot', () => {
    expect(labelAge('2001-12-12', 23, 'YEARS')).toBe('24 Years');
  });

  it('counts the age up to the branch-local date, not the UTC date', () => {
    // 31 days to the IST date (the 25th); the UTC date would give 30.
    expect(labelAge('2026-08-25')).toBe('31 Days');
  });

  it('falls back to the age snapshot without a DOB', () => {
    expect(labelAge(null, 6, 'MONTHS')).toBe('6 Months');
    expect(labelAge(null)).toBe('');
  });
});

describe('OrderSampleService — order overview hides superseded originals', () => {
  type Row = {
    id: string;
    status: string;
    branchId: string | null;
    tests: Array<{ orderItemId: string; labTestId: string | null }>;
  };
  const A = 'branchA';
  const B = 'branchB';
  const C = 'branchC';
  const test = (orderItemId: string, labTestId: string | null = 't1') => ({
    orderItemId,
    labTestId,
  });
  const row = (
    id: string,
    status: string,
    branchId: string,
    tests = [test('i1')],
  ): Row => ({ id, status, branchId, tests });

  function run(
    rows: Row[],
    acceptedTransfers: Array<{ sampleId: string; destinationBranchId: string }>,
  ) {
    const findMany = jest.fn().mockResolvedValue(acceptedTransfers);
    const tx = { sampleTransfer: { findMany } };
    const service = new OrderSampleService(
      {} as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
      {} as unknown as AppointmentService,
    );
    const result = (
      service as unknown as {
        supersededSampleIds: (
          tx: unknown,
          tenantId: string,
          rows: Row[],
        ) => Promise<Set<string>>;
      }
    ).supersededSampleIds(tx, 't1', rows);
    return { result, findMany };
  }

  it('hides the sender original once the transfer is accepted and the receiving copy exists', async () => {
    const { result } = run(
      [row('orig', 'SENT_INTERNAL', A), row('copy', 'ACCEPTED', B)],
      [{ sampleId: 'orig', destinationBranchId: B }],
    );
    expect([...(await result)]).toEqual(['orig']);
  });

  it('keeps the original while the transfer is still on its way (no accepted transfer, no copy)', async () => {
    const { result, findMany } = run(
      [row('orig', 'SENT_INTERNAL', A)],
      [], // the query only returns ACCEPTED transfers
    );
    expect((await result).size).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps the original when its accepted transfer has no live copy any more (copy voided)', async () => {
    const { result } = run(
      [row('orig', 'SENT_INTERNAL', A)],
      [{ sampleId: 'orig', destinationBranchId: B }],
    );
    expect((await result).size).toBe(0);
  });

  it('chain A → B → C: hides the originals at A and B, shows only the holder at C', async () => {
    const { result } = run(
      [
        row('atA', 'SENT_INTERNAL', A),
        row('atB', 'SENT_INTERNAL', B),
        row('atC', 'ACCEPTED', C),
      ],
      [
        { sampleId: 'atA', destinationBranchId: B },
        { sampleId: 'atB', destinationBranchId: C },
      ],
    );
    expect([...(await result)].sort()).toEqual(['atA', 'atB']);
  });

  it('A → B accepted, then B → C still in transit: only the sender original is hidden', async () => {
    const { result } = run(
      [row('atA', 'SENT_INTERNAL', A), row('atB', 'SENT_INTERNAL', B)],
      [{ sampleId: 'atA', destinationBranchId: B }],
    );
    expect([...(await result)]).toEqual(['atA']);
  });

  it('does not mix up the member samples of a panel: a copy of one member does not hide another', async () => {
    const memberA = [test('panel', 'chol')];
    const memberB = [test('panel', 'trig')];
    const { result } = run(
      [
        row('s1', 'SENT_INTERNAL', A, memberA),
        row('s2', 'SENT_INTERNAL', A, memberB),
        row('c1', 'ACCEPTED', B, memberA), // copy of s1 only
      ],
      [
        { sampleId: 's1', destinationBranchId: B },
        { sampleId: 's2', destinationBranchId: B },
      ],
    );
    expect([...(await result)]).toEqual(['s1']);
  });

  it("a copy that lacks one of the original's tests does not supersede it", async () => {
    const { result } = run(
      [
        row('orig', 'SENT_INTERNAL', A, [test('i1'), test('i2')]),
        row('copy', 'ACCEPTED', B, [test('i1')]),
      ],
      [{ sampleId: 'orig', destinationBranchId: B }],
    );
    expect((await result).size).toBe(0);
  });

  it('makes no transfer query at all when nothing in the order is Sent', async () => {
    const { result, findMany } = run([row('a', 'ACCEPTED', A)], []);
    expect((await result).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('OrderSampleService — transitionInTx concurrency claim', () => {
  const sample = {
    id: 's1',
    tenantId: 't1',
    branchId: 'A',
    status: 'ACCEPTED',
    previousStatus: null,
  };

  const build = (claimCount: number) => {
    const claim = jest.fn().mockResolvedValue({ count: claimCount });
    const update = jest
      .fn()
      .mockResolvedValue({ ...sample, status: 'SENT_INTERNAL' });
    const history = jest.fn();
    const tx = {
      orderSample: {
        findFirst: jest.fn().mockResolvedValue(sample),
        updateMany: claim,
        update,
      },
      orderSampleStatusHistory: { create: history },
      // the "is the order cancelled?" probe: not cancelled
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      // the "test removed from the order" probe: no removed test
      orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new OrderSampleService(
      {} as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
      {} as unknown as AppointmentService,
    );
    const run = () =>
      (
        service as unknown as {
          transitionInTx: (...a: unknown[]) => Promise<unknown>;
        }
      ).transitionInTx(tx, 't1', 'p1', 's1', 'send', () => ({ data: {} }));
    return { claim, update, history, run };
  };

  it('claims the row on the status it read, then applies the transition once', async () => {
    const { claim, update, history, run } = build(1);
    await run();
    expect(firstCallArg(claim)).toMatchObject({
      where: { id: 's1', status: 'ACCEPTED' },
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(history).toHaveBeenCalledTimes(1);
  });

  it('refuses (no update, no history row) when a concurrent request already moved the sample', async () => {
    const { update, history, run } = build(0);
    await expect(run()).rejects.toBeInstanceOf(
      InvalidSampleTransitionException,
    );
    expect(update).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });
});

describe('OrderSampleService - a cancelled order freezes its samples', () => {
  const baseSample = {
    id: 's1',
    orderId: 'o1',
    tenantId: 't1',
    branchId: 'A',
    status: 'ACCEPTED',
    previousStatus: null,
    sourceTransferId: null as string | null,
  };
  const build = (cancelled: boolean, over: Partial<typeof baseSample> = {}) => {
    const sample = { ...baseSample, ...over };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      orderSample: {
        findFirst: jest.fn().mockResolvedValue(sample),
        findMany: jest.fn().mockResolvedValue([sample]),
        updateMany,
        update: jest.fn().mockResolvedValue(sample),
      },
      orderSampleStatusHistory: { create: jest.fn() },
      order: {
        findFirst: jest.fn().mockResolvedValue(cancelled ? { id: 'o1' } : null),
      },
      // the "test removed from the order" probe: no removed test
      orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new OrderSampleService(
      {} as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
      {} as unknown as AppointmentService,
    );
    const transition = (action: string, note: object = {}) =>
      (
        service as unknown as {
          transitionInTx: (...a: unknown[]) => Promise<unknown>;
        }
      ).transitionInTx(
        tx,
        't1',
        'p1',
        's1',
        action,
        () => ({ data: {} }),
        note,
      );
    return { tx, updateMany, transition, service };
  };

  it.each(['collect', 'accept', 'hold', 'repeat', 'send', 'discard'])(
    '%s is refused and nothing is written',
    async (action) => {
      const { tx, updateMany, transition } = build(true);
      await expect(transition(action)).rejects.toBeInstanceOf(
        SampleOrderCancelledException,
      );
      expect(updateMany).not.toHaveBeenCalled();
      expect(tx.orderSample.update).not.toHaveBeenCalled();
      expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
    },
  );

  describe('the wind-down of a sample that is out at another branch stays open', () => {
    it("the sender's Retrieve is not stopped by the cancelled order", async () => {
      const { tx, transition } = build(true, { status: 'SENT_INTERNAL' });
      await transition('retrieve').catch((e: unknown) => {
        expect(e).not.toBeInstanceOf(SampleOrderCancelledException);
      });
      // the freeze does not even look: Retrieve is on the open list
      expect(tx.order.findFirst).not.toHaveBeenCalled();
    });

    it.each(['store', 'discard'])(
      "the receiving branch's %s of its own copy is not stopped",
      async (action) => {
        const { tx, transition } = build(true, { sourceTransferId: 'tr1' });
        await transition(action).catch((e: unknown) => {
          expect(e).not.toBeInstanceOf(SampleOrderCancelledException);
        });
        expect(tx.order.findFirst).not.toHaveBeenCalled();
      },
    );

    it.each(['store', 'discard'])(
      '%s of a sample that is NOT a transferred copy stays refused',
      async (action) => {
        const { transition } = build(true, { sourceTransferId: null });
        await expect(transition(action)).rejects.toBeInstanceOf(
          SampleOrderCancelledException,
        );
      },
    );

    it.each(['SENT_INTERNAL', 'FORWARD_EXTERNAL', 'OUTSOURCED'])(
      'Retrieve of a sample that is out (%s) is not stopped',
      async (status) => {
        const { tx, transition } = build(true, { status });
        await transition('retrieve').catch((e: unknown) => {
          expect(e).not.toBeInstanceOf(SampleOrderCancelledException);
        });
        expect(tx.order.findFirst).not.toHaveBeenCalled();
      },
    );

    it.each(['NEW', 'COLLECTED', 'ACCEPTED', 'HOLD', 'STORED', 'RETURNED'])(
      'Retrieve of a sample that is NOT out (%s) is refused on a cancelled order, nothing written',
      async (status) => {
        const { tx, updateMany, transition } = build(true, { status });
        await expect(transition('retrieve')).rejects.toBeInstanceOf(
          SampleOrderCancelledException,
        );
        expect(updateMany).not.toHaveBeenCalled();
        expect(tx.orderSample.update).not.toHaveBeenCalled();
        expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
      },
    );

    it('the Retrieve refusal names Retrieve and says only a sample that is out can be retrieved', async () => {
      const { transition } = build(true, { status: 'ACCEPTED' });
      const e = (await transition('retrieve').catch(
        (x: unknown) => x,
      )) as SampleOrderCancelledException;
      expect(e).toBeInstanceOf(InvalidSampleTransitionException);
      expect(e.errorCode).toBe('SAMPLE_ORDER_CANCELLED');
      expect(e.getStatus()).toBe(422);
      const msg = (e.getResponse() as { error: { message: string } }).error
        .message;
      expect(msg).toContain('This order has been cancelled');
      expect(msg).toContain('Retrieve');
      expect(msg).toContain('out at another branch');
    });

    it('the cancelled-order reason wins over "nothing to retrieve" for a sample that was already recalled', async () => {
      const { transition } = build(true, {
        status: 'ACCEPTED',
        previousStatus: 'SENT_INTERNAL' as never,
      });
      await expect(transition('retrieve')).rejects.toBeInstanceOf(
        SampleOrderCancelledException,
      );
    });

    it('the other cancelled-order refusals keep their own wording', async () => {
      const { transition } = build(true, { status: 'ACCEPTED' });
      const e = (await transition('hold').catch(
        (x: unknown) => x,
      )) as SampleOrderCancelledException;
      const msg = (e.getResponse() as { error: { message: string } }).error
        .message;
      expect(msg).toBe(
        'This order has been cancelled, so "hold" is not allowed on its samples.',
      );
    });

    it("the system-driven moves of the receiving branch's Reject / Repeat / Return are not stopped", async () => {
      const { tx, transition } = build(true, { status: 'SENT_INTERNAL' });
      await transition('repeat', { system: true, force: true }).catch(
        (e: unknown) => {
          expect(e).not.toBeInstanceOf(SampleOrderCancelledException);
        },
      );
      expect(tx.order.findFirst).not.toHaveBeenCalled();
    });
  });

  it('is skippable by a group "skip invalid" action (an invalid-transition error)', async () => {
    const { transition } = build(true);
    await expect(transition('accept')).rejects.toBeInstanceOf(
      InvalidSampleTransitionException,
    );
  });

  it('asks about the order of THIS sample, tenant-scoped', async () => {
    const { tx, transition } = build(true);
    await transition('accept').catch(() => undefined);
    expect(tx.order.findFirst.mock.calls[0]).toEqual([
      expect.objectContaining({
        where: { id: 'o1', tenantId: 't1', status: 'CANCELLED' },
      }),
    ]);
  });

  it('an order that is not cancelled goes on to the normal transition', async () => {
    const { updateMany, transition } = build(false);
    await transition('send').catch(() => undefined);
    expect(updateMany).toHaveBeenCalled();
  });

  it('assign barcode is refused on a cancelled order', async () => {
    const { tx, service } = build(true);
    const prisma = {
      withTenant: (_t: string, fn: (x: typeof tx) => unknown) => fn(tx),
    };
    (service as unknown as { prisma: unknown }).prisma = prisma;
    await expect(
      service.assignBarcode(['s1'], 't1', 'p1', { barcode: 'X1' }),
    ).rejects.toBeInstanceOf(SampleOrderCancelledException);
  });

  // The barcode belongs to the tube that travels: no edit while the sample is out,
  // nor on a copy received from another branch.
  const assignOn = (over: Partial<typeof baseSample>) => {
    const { tx, service } = build(false, over);
    const prisma = {
      withTenant: (_t: string, fn: (x: typeof tx) => unknown) => fn(tx),
    };
    (service as unknown as { prisma: unknown }).prisma = prisma;
    return { tx, service };
  };

  it.each(['SENT_INTERNAL', 'FORWARD_EXTERNAL', 'OUTSOURCED'])(
    'assign barcode is refused on a %s sample and writes nothing',
    async (status) => {
      const { tx, service } = assignOn({ status });
      await expect(
        service.assignBarcode(['s1'], 't1', 'p1', { barcode: 'X1' }),
      ).rejects.toBeInstanceOf(SampleBarcodeLockedException);
      expect(tx.orderSample.updateMany).not.toHaveBeenCalled();
      expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
    },
  );

  it('assign barcode is refused on a copy received from another branch, even to re-save the same value', async () => {
    const { tx, service } = assignOn({
      status: 'ACCEPTED',
      sourceTransferId: 'tr1',
    });
    await expect(
      service.assignBarcode(['s1'], 't1', 'p1', {}),
    ).rejects.toBeInstanceOf(SampleBarcodeLockedException);
    expect(tx.orderSample.updateMany).not.toHaveBeenCalled();
  });

  it('a normal in-house sample is not locked: it goes on to assign the barcode', async () => {
    const { tx, service } = assignOn({ status: 'ACCEPTED' });
    (service as unknown as { barcodeService: unknown }).barcodeService = {
      allocateNumberInTx: jest.fn().mockResolvedValue('10001'),
      generateAndUpload: jest.fn().mockResolvedValue('https://img/10001.png'),
    };
    jest
      .spyOn(
        service as unknown as {
          findById: (...a: unknown[]) => Promise<unknown>;
        },
        'findById',
      )
      .mockResolvedValue({ id: 's1' });
    await service.assignBarcode(['s1'], 't1', 'p1', {});
    expect(tx.orderSample.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('OrderSampleService — retrieve target', () => {
  const retrieveTarget = (sample: {
    status: string;
    previousStatus: string | null;
  }) =>
    (
      new OrderSampleService(
        {} as unknown as PrismaService,
        {} as unknown as AccessionSettingsService,
        {} as unknown as LabReportService,
        {} as unknown as PdfReportTemplateService,
        {} as unknown as PdfTemplateConfigService,
        {} as unknown as EventEmitter2,
        {} as unknown as TenantService,
        {} as unknown as BarcodeService,
        {} as unknown as UserDepartmentScopeService,
        {} as unknown as AppointmentService,
      ) as unknown as { retrieveTarget: (s: unknown) => string | null }
    ).retrieveTarget(sample);

  it('puts a sent sample back to the status it had before the send', () => {
    expect(
      retrieveTarget({ status: 'SENT_INTERNAL', previousStatus: 'NEW' }),
    ).toBe('NEW');
    expect(
      retrieveTarget({ status: 'SENT_INTERNAL', previousStatus: 'COLLECTED' }),
    ).toBe('COLLECTED');
    expect(
      retrieveTarget({
        status: 'FORWARD_EXTERNAL',
        previousStatus: 'ACCEPTED',
      }),
    ).toBe('ACCEPTED');
  });

  it('falls back to Accepted when the previous status is missing or unusable', () => {
    expect(
      retrieveTarget({ status: 'SENT_INTERNAL', previousStatus: null }),
    ).toBe('ACCEPTED');
    expect(
      retrieveTarget({ status: 'OUTSOURCED', previousStatus: 'CANCELLED' }),
    ).toBe('ACCEPTED');
    expect(
      retrieveTarget({
        status: 'SENT_INTERNAL',
        previousStatus: 'SENT_INTERNAL',
      }),
    ).toBe('ACCEPTED');
  });
});

describe('OrderSampleService — Return of a transferred copy', () => {
  type Priv = {
    returnCopyToOrigin: jest.Mock;
    transitionIds: jest.Mock;
    findById: jest.Mock;
  };
  function setup(copies: Array<{ id: string; status: string }>) {
    const transferUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      orderSample: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            copies.map((c) => ({ ...c, sourceTransferId: 'tr1' })),
          ),
      },
      sampleTransfer: { updateMany: transferUpdate },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const service = new OrderSampleService(
      prisma as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
      {} as unknown as AppointmentService,
    );
    const priv = service as unknown as Priv;
    priv.returnCopyToOrigin = jest.fn().mockResolvedValue('origin1');
    priv.transitionIds = jest
      .fn()
      .mockResolvedValue({ succeeded: [{ id: 'plain-result' }], skipped: [] });
    priv.findById = jest.fn((id: string) => Promise.resolve({ id }));
    return { service, transferUpdate, priv };
  }

  it('sends a transferred copy back to its sender instead of marking it Returned', async () => {
    const { service, transferUpdate, priv } = setup([
      { id: 'copy1', status: 'ACCEPTED' },
    ]);
    const out = await service.returnSample(['copy1'], 't1', 'p1', {
      handoverPerson: 'X',
    });
    expect(priv.returnCopyToOrigin).toHaveBeenCalledTimes(1);
    expect(priv.transitionIds).not.toHaveBeenCalled();
    expect(firstCallArg(transferUpdate)).toMatchObject({
      data: { transferStatus: 'REPEAT' },
    });
    // the sender's original (still Sent) is reported in the copy's place; the
    // referring panel is told only when the SENDER then acts (Repeat / Error)
    expect(out).toEqual({ succeeded: [{ id: 'origin1' }], skipped: [] });
  });

  it('repeat: a Sent sample is never handled as a copy (a branch that passed its copy on can confirm the Repeat the next branch asked for)', async () => {
    const { service, priv } = setup([]);
    (priv as unknown as { emitSampleFlagged: jest.Mock }).emitSampleFlagged =
      jest.fn();
    await service.repeat(['s1'], 't1', 'p1', { repeatReason: 'clotted' });
    const prisma = (service as unknown as { prisma: { withTenant: jest.Mock } })
      .prisma;
    const txArg = prisma.withTenant.mock.calls[0] as [
      string,
      (t: unknown) => unknown,
    ];
    const probe = { orderSample: { findMany: jest.fn() } };
    await txArg[1](probe);
    expect(firstCallArg(probe.orderSample.findMany)).toMatchObject({
      where: {
        sourceTransferId: { not: null },
        status: { not: 'SENT_INTERNAL' },
      },
    });
    expect(priv.transitionIds).toHaveBeenCalledTimes(1);
  });

  it('a normal sample (not a copy) keeps the ordinary Return', async () => {
    const { service, priv } = setup([]);
    const out = await service.returnSample(['s1'], 't1', 'p1', {});
    expect(priv.returnCopyToOrigin).not.toHaveBeenCalled();
    expect(priv.transitionIds).toHaveBeenCalledWith(
      ['s1'],
      't1',
      'p1',
      'return',
      expect.any(Function),
      expect.anything(),
    );
    expect(out).toEqual({ succeeded: [{ id: 'plain-result' }], skipped: [] });
  });

  it('refuses a copy that cannot be returned from its status, and skips it in a group', async () => {
    const strict = setup([{ id: 'copy1', status: 'SENT_INTERNAL' }]);
    await expect(
      strict.service.returnSample(['copy1'], 't1', 'p1', {}),
    ).rejects.toBeInstanceOf(InvalidSampleTransitionException);
    expect(strict.priv.returnCopyToOrigin).not.toHaveBeenCalled();

    const group = setup([{ id: 'copy1', status: 'SENT_INTERNAL' }]);
    const out = await group.service.returnSample(['copy1'], 't1', 'p1', {
      skipInvalid: true,
    } as never);
    expect(group.priv.returnCopyToOrigin).not.toHaveBeenCalled();
    // Skipped, and named with the same wording as every other skipped sample.
    expect(out).toEqual({
      succeeded: [],
      skipped: [
        {
          id: 'copy1',
          accessionNo: null,
          reason: 'Action "return" is not allowed from status SENT_INTERNAL',
          code: 'INVALID_SAMPLE_TRANSITION',
        },
      ],
    });
  });
});
