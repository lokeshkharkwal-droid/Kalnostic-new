import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { BarcodeService } from './barcode.service';

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
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
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
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
    );
  }

  it('voids a sample linked only to removed items and drops shared links', async () => {
    const now = new Date('2026-09-11T00:00:00Z');
    const tx = {
      orderSample: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'S1', tests: [{ id: 'l1', orderItemId: 'R1' }] },
          { id: 'S2', tests: [{ id: 'l2', orderItemId: 'R1' }, { id: 'l3', orderItemId: 'K1' }] },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      orderSampleTest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      labReport: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as import('@prisma/client').Prisma.TransactionClient;

    const service = makeService();
    await (service as unknown as {
      reconcileForOrderInTx: (
        tx: unknown, t: string, b: string | null, p: string | null, o: string,
        opts: { addedItemIds: string[]; removedItemIds: string[]; now: Date },
      ) => Promise<void>;
    }).reconcileForOrderInTx(tx, 'ten1', 'br1', 'per1', 'ord1', {
      addedItemIds: [], removedItemIds: ['R1'], now,
    });

    // S1 exclusive to R1 -> voided (soft-deleted + CANCELLED)
    expect((tx.orderSample.update as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'S1' },
        data: expect.objectContaining({ deletedAt: now, status: 'CANCELLED' }),
      }),
    );
    // S2 shared -> NOT voided
    expect((tx.orderSample.update as jest.Mock)).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'S2' } }),
    );
    // OrderSampleTest has deletedAt -> soft-delete the removed link (l2)
    expect((tx.orderSampleTest.updateMany as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['l2'] } },
        data: expect.objectContaining({ deletedAt: now }),
      }),
    );
    // removed items' reports soft-deleted
    expect((tx.labReport.updateMany as jest.Mock)).toHaveBeenCalled();
  });
});
