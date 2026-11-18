import { EventEmitter2 } from '@nestjs/event-emitter';
import { SampleStatus } from '@prisma/client';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import {
  OrderSampleNotFoundException,
  SampleFlagNotAllowedException,
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
 * Mark Recoverable / Mark Returned & Verified (Sample Search popup) with `skipInvalid`: a row that someone else changed a moment
 * ago (no longer Discarded / Returned, already verified) is left out and named in `skipped`, instead of failing the rows that are
 * still fine. Without it the call stays all-or-nothing.
 */
describe('OrderSampleService - the flag buttons with skipInvalid', () => {
  type Sample = {
    id: string;
    status: SampleStatus;
    branchId: string;
    orderId: string;
    accessionNo: string;
    isRecoverable: boolean | null;
    returnedVerifiedAt: Date | null;
  };
  const row = (id: string, over: Partial<Sample> = {}): Sample => ({
    id,
    status: SampleStatus.DISCARDED,
    branchId: 'b1',
    orderId: 'o1',
    accessionNo: `ACC-${id}`,
    isRecoverable: false,
    returnedVerifiedAt: null,
    ...over,
  });

  const build = (samples: Sample[], cancelledOrders: string[] = []) => {
    const byId = new Map(samples.map((s) => [s.id, s]));
    const tx = {
      order: {
        findFirst: jest
          .fn()
          .mockImplementation((a: { where: { id: string } }) =>
            Promise.resolve(
              cancelledOrders.includes(a.where.id) ? { id: a.where.id } : null,
            ),
          ),
      },
      orderSample: {
        findFirst: jest
          .fn()
          .mockImplementation((a: { where: { id: string } }) =>
            Promise.resolve(byId.get(a.where.id) ?? null),
          ),
        update: jest.fn().mockResolvedValue({}),
      },
      orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, cb: (t: typeof tx) => unknown) =>
        cb(tx),
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
    jest
      .spyOn(service, 'findById')
      .mockImplementation((id: string) => Promise.resolve({ id }) as never);
    const written = () =>
      (
        tx.orderSample.update.mock.calls as unknown as [
          { where: { id: string } },
        ][]
      ).map(([a]) => a.where.id);
    return { tx, service, written };
  };

  describe('Mark Recoverable', () => {
    const rows = () => [
      row('s1'),
      row('s2', { status: SampleStatus.STORED, isRecoverable: null }),
    ];

    it('skips a row that is no longer Discarded and still changes the others', async () => {
      const { service, written } = build(rows());
      const r = await service.setRecoverable(['s1', 's2'], 't1', 'p1', {
        ids: ['s1', 's2'],
        isRecoverable: true,
        skipInvalid: true,
      });
      expect(written()).toEqual(['s1']);
      expect(r.succeeded).toHaveLength(1);
      expect(r.skipped).toEqual([
        expect.objectContaining({
          id: 's2',
          accessionNo: 'ACC-s2',
          code: 'SAMPLE_FLAG_NOT_ALLOWED',
        }),
      ]);
    });

    it('without skipInvalid the same call still fails as a whole', async () => {
      const { service } = build(rows());
      await expect(
        service.setRecoverable(['s1', 's2'], 't1', 'p1', {
          ids: ['s1', 's2'],
          isRecoverable: true,
        }),
      ).rejects.toBeInstanceOf(SampleFlagNotAllowedException);
    });

    it('a row that already has the value is not an error and writes nothing', async () => {
      const { service, written } = build([row('s1', { isRecoverable: true })]);
      const r = await service.setRecoverable(['s1'], 't1', 'p1', {
        ids: ['s1'],
        isRecoverable: true,
        skipInvalid: true,
      });
      expect(written()).toEqual([]);
      expect(r.succeeded).toHaveLength(1);
      expect(r.skipped).toEqual([]);
    });

    it('a row of a cancelled order is skipped too', async () => {
      const { service, written } = build(
        [row('s1'), row('s2', { orderId: 'o2' })],
        ['o2'],
      );
      const r = await service.setRecoverable(['s1', 's2'], 't1', 'p1', {
        ids: ['s1', 's2'],
        isRecoverable: true,
        skipInvalid: true,
      });
      expect(written()).toEqual(['s1']);
      expect(r.skipped.map((s) => s.id)).toEqual(['s2']);
    });

    it('a missing id still fails the whole call, skipInvalid or not', async () => {
      const { service } = build([row('s1')]);
      await expect(
        service.setRecoverable(['s1', 'gone'], 't1', 'p1', {
          ids: ['s1', 'gone'],
          isRecoverable: true,
          skipInvalid: true,
        }),
      ).rejects.toBeInstanceOf(OrderSampleNotFoundException);
    });
  });

  describe('Mark Returned & Verified', () => {
    const returned = (id: string, verified = false) =>
      row(id, {
        status: SampleStatus.RETURNED,
        isRecoverable: null,
        returnedVerifiedAt: verified ? new Date('2026-11-17T10:00:00Z') : null,
      });

    it('skips a row someone has just verified and verifies the others', async () => {
      const { service, written } = build([
        returned('s1'),
        returned('s2', true),
      ]);
      const r = await service.markReturnedVerified(['s1', 's2'], 't1', 'p1', {
        ids: ['s1', 's2'],
        skipInvalid: true,
      });
      expect(written()).toEqual(['s1']);
      expect(r.skipped).toEqual([
        expect.objectContaining({
          id: 's2',
          reason: 'This returned sample is already marked as verified.',
        }),
      ]);
    });

    it('without skipInvalid a row that is already verified fails the whole call (nothing is verified)', async () => {
      const { service } = build([returned('s1'), returned('s2', true)]);
      await expect(
        service.markReturnedVerified(['s1', 's2'], 't1', 'p1', {
          ids: ['s1', 's2'],
        }),
      ).rejects.toBeInstanceOf(SampleFlagNotAllowedException);
    });

    it('skips a row that is no longer Returned', async () => {
      const { service, written } = build([
        returned('s1'),
        row('s2', { status: SampleStatus.ACCEPTED, isRecoverable: null }),
      ]);
      const r = await service.markReturnedVerified(['s1', 's2'], 't1', 'p1', {
        ids: ['s1', 's2'],
        skipInvalid: true,
      });
      expect(written()).toEqual(['s1']);
      expect(r.skipped.map((s) => s.id)).toEqual(['s2']);
    });
  });
});
