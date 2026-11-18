import { EventEmitter2 } from '@nestjs/event-emitter';
import { LabReportStatus, SampleStatus } from '@prisma/client';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import {
  InvalidSampleTransitionException,
  SampleStoreReturnBlockedException,
  refusalMessage,
} from './exceptions/accession.exceptions';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { BarcodeService } from './barcode.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { AppointmentService } from '../appointment/appointment.service';

/**
 * The Store / Return gate (Sample Search requirements, 2026-11-06): an ACCEPTED tube can be Stored or Returned only
 * when every test on its barcode (same branch and order) has a PUBLISHED report. A test with no report counts as not
 * published. Acquired / Halt / Error tubes are not gated; a removed-test sample and the received copy of a cancelled
 * order are exempt so they can still be put away.
 */
describe('OrderSampleService - Store / Return need every test published', () => {
  type Row = {
    id: string;
    status?: SampleStatus;
    /** report statuses this row serves; [] = no report at all */
    reports: LabReportStatus[];
    removed?: boolean;
  };

  /** The sample being acted on, its barcode group and the report world around it. */
  const world = (opts: {
    status?: SampleStatus;
    sourceTransferId?: string | null;
    orderCancelled?: boolean;
    barcode?: string | null;
    rows: Row[];
  }) => {
    const self = opts.rows[0]!;
    const sample = {
      id: self.id,
      tenantId: 't1',
      branchId: 'b1',
      orderId: 'o1',
      barcode: opts.barcode === undefined ? '10050' : opts.barcode,
      status: opts.status ?? SampleStatus.ACCEPTED,
      sourceTransferId: opts.sourceTransferId ?? null,
    };
    // reports are numbered so each row gets its own ids
    const reportIdsOf = (rowId: string) =>
      opts.rows
        .find((r) => r.id === rowId)!
        .reports.map((_, i) => `${rowId}-r${i}`);
    const statusOfReport = new Map<string, LabReportStatus>();
    opts.rows.forEach((r) =>
      r.reports.forEach((s, i) => statusOfReport.set(`${r.id}-r${i}`, s)),
    );

    const tx = {
      order: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.orderCancelled ? { id: 'o1' } : null),
      },
      orderSample: {
        // the claim, the barcode group, the final update
        findFirst: jest.fn().mockResolvedValue(sample),
        findMany: jest
          .fn()
          .mockResolvedValue(
            opts.rows.map((r) => ({ id: r.id, branchId: 'b1' })),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(sample),
      },
      orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      orderSampleTest: {
        findMany: jest.fn(({ select }: { select: Record<string, unknown> }) =>
          Promise.resolve(
            opts.rows.map((r) =>
              'orderItem' in select
                ? {
                    sampleId: r.id,
                    orderItem: { deletedAt: r.removed ? new Date() : null },
                  }
                : { sampleId: r.id, orderItemId: `i-${r.id}`, labTestId: null },
            ),
          ),
        ),
      },
      labReport: {
        findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            where.id.in.map((id) => ({ id, status: statusOfReport.get(id) })),
          ),
        ),
      },
    };
    const lab = {
      findReportIdsForSampleTests: jest.fn(
        (
          _tx: unknown,
          _t: string,
          _b: string,
          links: { orderItemId: string }[],
        ) =>
          Promise.resolve(
            links.flatMap((l) => reportIdsOf(l.orderItemId.replace('i-', ''))),
          ),
      ),
      lockReports: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OrderSampleService(
      {} as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      lab as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
      {} as unknown as AppointmentService,
    );
    const act = (action: string, note: object = {}) =>
      (
        service as unknown as {
          transitionInTx: (...a: unknown[]) => Promise<unknown>;
        }
      ).transitionInTx(
        tx,
        't1',
        'p1',
        self.id,
        action,
        () => ({ data: {} }),
        note,
      );
    const gate = () => service.storeReturnGate(tx as never, 't1', sample);
    return { tx, lab, act, gate };
  };

  const P = LabReportStatus.PUBLISHED;
  const A = LabReportStatus.APPROVED;

  describe('the gate itself', () => {
    it('counts nothing unpublished when every test of the barcode is Published', async () => {
      const { gate } = world({
        rows: [
          { id: 's1', reports: [P] },
          { id: 's2', reports: [P] },
        ],
      });
      await expect(gate()).resolves.toEqual({
        gated: true,
        unpublished: 0,
        unpublishedSampleIds: [],
      });
    });

    it('counts the tests of the barcode that are not Published (Approved is not enough)', async () => {
      const { gate } = world({
        rows: [
          { id: 's1', reports: [P] },
          { id: 's2', reports: [A] },
          { id: 's3', reports: [LabReportStatus.PENDING] },
        ],
      });
      await expect(gate()).resolves.toEqual({
        gated: true,
        unpublished: 2,
        unpublishedSampleIds: ['s2', 's3'],
      });
    });

    it('a row with a mix of Published and not Published reports counts once', async () => {
      const { gate } = world({
        rows: [{ id: 's1', reports: [P, LabReportStatus.ERROR_REPORTED] }],
      });
      await expect(gate()).resolves.toEqual(
        expect.objectContaining({ gated: true, unpublished: 1 }),
      );
    });

    it('a row with NO report counts as not published', async () => {
      const { gate } = world({ rows: [{ id: 's1', reports: [] }] });
      await expect(gate()).resolves.toEqual(
        expect.objectContaining({ gated: true, unpublished: 1 }),
      );
    });

    it('looks only at live rows of the same barcode, branch and order, and skips Sent / Cancelled / Returned / Discarded rows', async () => {
      const { gate, tx } = world({ rows: [{ id: 's1', reports: [P] }] });
      await gate();
      const calls = tx.orderSample.findMany.mock.calls as unknown as [
        { where: Record<string, unknown> },
      ][];
      expect(calls[0]![0].where).toMatchObject({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        barcode: '10050',
        deletedAt: null,
        status: {
          notIn: [
            SampleStatus.SENT_INTERNAL,
            SampleStatus.CANCELLED,
            SampleStatus.RETURNED,
            SampleStatus.DISCARDED,
          ],
        },
      });
    });

    it('a sample with no barcode is a group of one (no barcode lookup)', async () => {
      const { gate, tx } = world({
        barcode: null,
        rows: [{ id: 's1', reports: [A] }],
      });
      await expect(gate()).resolves.toEqual(
        expect.objectContaining({ gated: true, unpublished: 1 }),
      );
      expect(tx.orderSample.findMany).not.toHaveBeenCalled();
    });

    it('locks the reports it looked at', async () => {
      const { gate, lab } = world({ rows: [{ id: 's1', reports: [P] }] });
      await gate();
      expect(lab.lockReports).toHaveBeenCalledWith(expect.anything(), 't1', [
        's1-r0',
      ]);
    });

    it('is not gated for a sample whose own test was removed from the order', async () => {
      const { gate } = world({
        rows: [{ id: 's1', reports: [A], removed: true }],
      });
      await expect(gate()).resolves.toEqual({
        gated: false,
        unpublished: 0,
        unpublishedSampleIds: [],
      });
    });

    it('is not gated for the received copy of a cancelled order', async () => {
      const { gate } = world({
        sourceTransferId: 'tr1',
        orderCancelled: true,
        rows: [{ id: 's1', reports: [A] }],
      });
      await expect(gate()).resolves.toEqual({
        gated: false,
        unpublished: 0,
        unpublishedSampleIds: [],
      });
    });

    it('is still gated for a received copy of an order that is NOT cancelled', async () => {
      const { gate } = world({
        sourceTransferId: 'tr1',
        rows: [{ id: 's1', reports: [A] }],
      });
      await expect(gate()).resolves.toEqual(
        expect.objectContaining({ gated: true, unpublished: 1 }),
      );
    });

    it('ignores the rows of removed tests when counting the barcode group', async () => {
      const { gate } = world({
        rows: [
          { id: 's1', reports: [P] },
          { id: 's2', reports: [A], removed: true },
        ],
      });
      await expect(gate()).resolves.toEqual({
        gated: true,
        unpublished: 0,
        unpublishedSampleIds: [],
      });
    });
  });

  describe.each(['store', 'return'] as const)(
    '%s of an Accepted sample',
    (action) => {
      it('is refused, with the reason, while a test is not published', async () => {
        const { act, tx } = world({
          rows: [
            { id: 's1', reports: [P] },
            { id: 's2', reports: [A] },
          ],
        });
        const refusal = await act(action).catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(SampleStoreReturnBlockedException);
        // skippable by a group "skip invalid" action
        expect(refusal).toBeInstanceOf(InvalidSampleTransitionException);
        expect(
          refusalMessage(refusal as SampleStoreReturnBlockedException),
        ).toBe(
          `1 test on this barcode is not published yet (this can include tests in a department you cannot see), so the sample cannot be ${action === 'store' ? 'stored' : 'returned'}. Store and Return need every test published.`,
        );
        expect((refusal as SampleStoreReturnBlockedException).errorCode).toBe(
          'SAMPLE_STORE_RETURN_BLOCKED_NOT_PUBLISHED',
        );
        expect(tx.orderSample.update).not.toHaveBeenCalled();
        expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
      });

      it('is refused even when it is forced', async () => {
        const { act, tx } = world({ rows: [{ id: 's1', reports: [A] }] });
        await expect(act(action, { force: true })).rejects.toBeInstanceOf(
          SampleStoreReturnBlockedException,
        );
        expect(tx.orderSample.update).not.toHaveBeenCalled();
      });

      it('is refused for a tube with no report', async () => {
        const { act } = world({ rows: [{ id: 's1', reports: [] }] });
        await expect(act(action)).rejects.toBeInstanceOf(
          SampleStoreReturnBlockedException,
        );
      });

      it('goes through once every test is Published', async () => {
        const { act, tx } = world({
          rows: [
            { id: 's1', reports: [P] },
            { id: 's2', reports: [P] },
          ],
        });
        await act(action);
        expect(tx.orderSample.update).toHaveBeenCalledTimes(1);
      });

      it('is not asked about Published when the sample is Acquired, Halt or Error', async () => {
        for (const status of [
          SampleStatus.ACQUIRED,
          SampleStatus.HALT,
          SampleStatus.ERROR,
        ]) {
          const { act, lab } = world({
            status,
            rows: [{ id: 's1', reports: [LabReportStatus.PENDING] }],
          });
          // not every status allows both actions (Store from Error): a plain refusal is fine, the gate never ran
          await act(action).catch((e: unknown) => {
            expect(e).not.toBeInstanceOf(SampleStoreReturnBlockedException);
          });
          expect(lab.findReportIdsForSampleTests).not.toHaveBeenCalled();
        }
      });

      it('is not stopped for a system-driven move', async () => {
        const { act } = world({ rows: [{ id: 's1', reports: [A] }] });
        await expect(act(action, { system: true })).resolves.toBeDefined();
      });
    },
  );
});
