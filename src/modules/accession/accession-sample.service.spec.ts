import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Unit coverage for `samplesOfPanel` (private, exercised via an `as unknown`
 * cast — see auth.service.spec.ts for the same pattern). The regression guard:
 * a panel order item has no `branchLabTest` of its own, so before this method
 * existed `generateForOrderInTx` always created its accession sample with
 * `sampleType`/`containerType: null`. This asserts the fixed behaviour reads
 * the panel's constituent tests' `configSnapshot.samples` instead.
 */
describe('OrderSampleService — samplesOfPanel', () => {
  const txMock = {
    branchLabPanelTest: { findMany: jest.fn() },
    branchLabTest: { findMany: jest.fn() },
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
    );
  });

  /** Calls the private method under test without touching its access modifier. */
  const samplesOfPanel = (branchLabPanelId: string) =>
    (
      service as unknown as {
        samplesOfPanel: (
          tx: typeof txMock,
          tenantId: string,
          branchLabPanelId: string,
        ) => Promise<
          Array<{ sampleType: string | null; containerType: string | null }>
        >;
      }
    ).samplesOfPanel(txMock, 't1', branchLabPanelId);

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

  const snapshotWith = (
    samples: Array<{ sampleType: string; containerType: string }>,
  ) => ({ samples, resultParams: [] });

  it("resolves the sample/container type from the panel's single test", async () => {
    txMock.branchLabPanelTest.findMany.mockResolvedValue([
      { branchLabTestId: 'test-cbc' },
    ]);
    txMock.branchLabTest.findMany.mockResolvedValue([
      {
        configSnapshot: snapshotWith([
          { sampleType: 'Blood', containerType: 'EDTA_TUBE_PURPLE_TOP' },
        ]),
      },
    ]);

    const result = await samplesOfPanel('panel-1');

    expect(result).toEqual([
      { sampleType: 'Blood', containerType: 'EDTA_TUBE_PURPLE_TOP' },
    ]);
  });

  it('dedupes multiple tests that share the same tube type', async () => {
    txMock.branchLabPanelTest.findMany.mockResolvedValue([
      { branchLabTestId: 'test-a' },
      { branchLabTestId: 'test-b' },
    ]);
    txMock.branchLabTest.findMany.mockResolvedValue([
      {
        configSnapshot: snapshotWith([
          { sampleType: 'Blood', containerType: 'EDTA_TUBE_PURPLE_TOP' },
        ]),
      },
      {
        configSnapshot: snapshotWith([
          { sampleType: 'Blood', containerType: 'EDTA_TUBE_PURPLE_TOP' },
        ]),
      },
    ]);

    const result = await samplesOfPanel('panel-1');

    expect(result).toHaveLength(1);
  });

  it('unions distinct tube types when tests need different tubes', async () => {
    txMock.branchLabPanelTest.findMany.mockResolvedValue([
      { branchLabTestId: 'test-cbc' },
      { branchLabTestId: 'test-lft' },
    ]);
    txMock.branchLabTest.findMany.mockResolvedValue([
      {
        configSnapshot: snapshotWith([
          { sampleType: 'Blood', containerType: 'EDTA_TUBE_PURPLE_TOP' },
        ]),
      },
      {
        configSnapshot: snapshotWith([
          { sampleType: 'Serum', containerType: 'PLAIN_TUBE_RED_TOP' },
        ]),
      },
    ]);

    const result = await samplesOfPanel('panel-1');

    expect(result).toEqual([
      { sampleType: 'Blood', containerType: 'EDTA_TUBE_PURPLE_TOP' },
      { sampleType: 'Serum', containerType: 'PLAIN_TUBE_RED_TOP' },
    ]);
  });

  it('excludes soft-deleted panel-test links (deletedAt filter passed to the query)', async () => {
    txMock.branchLabPanelTest.findMany.mockResolvedValue([]);
    txMock.branchLabTest.findMany.mockResolvedValue([]);

    await samplesOfPanel('panel-1');

    expect(lastPanelTestWhere().deletedAt).toBeNull();
  });

  it('excludes soft-deleted BranchLabTest rows (deletedAt filter passed to the query)', async () => {
    txMock.branchLabPanelTest.findMany.mockResolvedValue([
      { branchLabTestId: 'test-a' },
    ]);
    txMock.branchLabTest.findMany.mockResolvedValue([]);

    await samplesOfPanel('panel-1');

    expect(lastLabTestWhere().deletedAt).toBeNull();
  });

  it('returns an empty list when the panel has no active tests', async () => {
    txMock.branchLabPanelTest.findMany.mockResolvedValue([]);

    const result = await samplesOfPanel('panel-1');

    expect(result).toEqual([]);
    expect(txMock.branchLabTest.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty list when the linked tests have no configSnapshot.samples', async () => {
    txMock.branchLabPanelTest.findMany.mockResolvedValue([
      { branchLabTestId: 'test-a' },
    ]);
    txMock.branchLabTest.findMany.mockResolvedValue([{ configSnapshot: {} }]);

    const result = await samplesOfPanel('panel-1');

    expect(result).toEqual([]);
  });
});
