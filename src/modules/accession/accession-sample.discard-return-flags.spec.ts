import { EventEmitter2 } from '@nestjs/event-emitter';
import { SampleStatus } from '@prisma/client';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import {
  InvalidSampleTransitionException,
  SampleFlagNotAllowedException,
  SampleOrderCancelledException,
  SampleRetrieveBlockedByFlagException,
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
 * The Discard / Return flags (Sample Search requirements, 2026-11-06):
 * - a Discard stores whether the physical sample is still recoverable; Retrieve out of Discarded is refused unless it is;
 * - a Returned sample must be confirmed physically back and verified before Retrieve out of Returned is allowed.
 */
describe('OrderSampleService - Discard / Return flags', () => {
  type Sample = {
    id: string;
    status: SampleStatus;
    branchId: string;
    orderId: string;
    isRecoverable: boolean | null;
    returnedVerifiedAt: Date | null;
  };

  const build = (over: Partial<Sample> = {}, orderCancelled = false) => {
    const sample: Sample = {
      id: 's1',
      status: SampleStatus.DISCARDED,
      branchId: 'b1',
      orderId: 'o1',
      isRecoverable: null,
      returnedVerifiedAt: null,
      ...over,
    };
    const tx = {
      order: {
        findFirst: jest
          .fn()
          .mockResolvedValue(orderCancelled ? { id: 'o1' } : null),
      },
      orderSample: {
        findFirst: jest.fn().mockResolvedValue(sample),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(sample),
      },
      orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
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
    const retrieve = (note: object = {}) =>
      (
        service as unknown as {
          transitionInTx: (...a: unknown[]) => Promise<unknown>;
        }
      ).transitionInTx(
        tx,
        't1',
        'p1',
        's1',
        'retrieve',
        () => ({ data: {} }),
        note,
      );
    const updateData = () =>
      (
        tx.orderSample.update.mock.calls as unknown as [
          { data: Record<string, unknown> },
        ][]
      )[0]![0].data;
    const history = () =>
      (
        tx.orderSampleStatusHistory.create.mock.calls as unknown as [
          { data: Record<string, unknown> },
        ][]
      ).map(([a]) => a.data);
    return { sample, tx, service, retrieve, updateData, history };
  };

  describe('Retrieve out of Discarded', () => {
    it.each([null, false])(
      'is refused while the flag is %s, and nothing is written',
      async (flag) => {
        const { retrieve, tx } = build({ isRecoverable: flag });
        const refusal = await retrieve().catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(SampleRetrieveBlockedByFlagException);
        // skippable by a group "skip invalid" action
        expect(refusal).toBeInstanceOf(InvalidSampleTransitionException);
        expect(
          (refusal as SampleRetrieveBlockedByFlagException).errorCode,
        ).toBe('SAMPLE_RETRIEVE_BLOCKED_NOT_RECOVERABLE');
        expect(tx.orderSample.update).not.toHaveBeenCalled();
        expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
      },
    );

    it('is not refused for a system-driven move', async () => {
      const { retrieve } = build({ isRecoverable: false });
      const result = await retrieve({ system: true }).catch((e: unknown) => e);
      expect(result).not.toBeInstanceOf(SampleRetrieveBlockedByFlagException);
    });
  });

  describe('Retrieve out of Returned', () => {
    it('is refused until the sample is verified, and nothing is written', async () => {
      const { retrieve, tx } = build({ status: SampleStatus.RETURNED });
      const refusal = await retrieve().catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(SampleRetrieveBlockedByFlagException);
      expect((refusal as SampleRetrieveBlockedByFlagException).errorCode).toBe(
        'SAMPLE_RETRIEVE_BLOCKED_NOT_VERIFIED',
      );
      expect(tx.orderSample.update).not.toHaveBeenCalled();
    });
  });

  describe('Discard', () => {
    const discard = (isRecoverable?: boolean) => {
      const m = build({ status: SampleStatus.STORED });
      return m.service
        .discard(['s1'], 't1', 'p1', {
          discardMethod: 'Biohazard Bag',
          ...(isRecoverable === undefined ? {} : { isRecoverable }),
        })
        .then(() => m);
    };

    it('stores the flag the person discarding gave', async () => {
      expect((await discard(true)).updateData().isRecoverable).toBe(true);
      expect((await discard(false)).updateData().isRecoverable).toBe(false);
    });

    it('stores "not recoverable" when the flag is omitted', async () => {
      expect((await discard()).updateData().isRecoverable).toBe(false);
    });
  });

  describe('setRecoverable', () => {
    const set = (m: ReturnType<typeof build>, value: boolean) =>
      m.service.setRecoverable(['s1'], 't1', 'p1', {
        ids: ['s1'],
        isRecoverable: value,
      });

    it('changes the flag of a Discarded sample and logs the change', async () => {
      const m = build({ isRecoverable: false });
      await set(m, true);
      expect(m.updateData().isRecoverable).toBe(true);
      expect(m.history()[0]).toMatchObject({
        action: 'recoverable-flag',
        fromStatus: SampleStatus.DISCARDED,
        toStatus: SampleStatus.DISCARDED,
        reason: 'Recoverable changed: No → Yes',
      });
    });

    it('can be switched back off', async () => {
      const m = build({ isRecoverable: true });
      await set(m, false);
      expect(m.updateData().isRecoverable).toBe(false);
      expect(m.history()[0]).toMatchObject({
        reason: 'Recoverable changed: Yes → No',
      });
    });

    it.each([
      [true, true],
      [false, false],
      [null, false],
    ])(
      'writes nothing when the flag (%s) already has the value asked for (%s)',
      async (current, asked) => {
        const m = build({ isRecoverable: current });
        const result = await set(m, asked);
        // a repeated click is a no-op: no write and no duplicate history row, but it still succeeds
        expect(m.tx.orderSample.update).not.toHaveBeenCalled();
        expect(m.tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
        expect(result.succeeded).toHaveLength(1);
        expect(result.skipped).toHaveLength(0);
      },
    );

    it('still refuses a sample that is not Discarded even when the value would not change', async () => {
      const m = build({ status: SampleStatus.STORED, isRecoverable: true });
      await expect(set(m, true)).rejects.toBeInstanceOf(
        SampleFlagNotAllowedException,
      );
    });

    it('refuses a sample that is not Discarded', async () => {
      const m = build({ status: SampleStatus.STORED });
      await expect(set(m, true)).rejects.toBeInstanceOf(
        SampleFlagNotAllowedException,
      );
      expect(m.tx.orderSample.update).not.toHaveBeenCalled();
    });

    it("refuses a cancelled order's sample", async () => {
      const m = build({}, true);
      await expect(set(m, true)).rejects.toBeInstanceOf(
        SampleOrderCancelledException,
      );
    });
  });

  describe('markReturnedVerified', () => {
    const verify = (m: ReturnType<typeof build>) =>
      m.service.markReturnedVerified(['s1'], 't1', 'p1', { ids: ['s1'] });

    it('stamps who and when on a Returned sample and logs it', async () => {
      const m = build({ status: SampleStatus.RETURNED });
      await verify(m);
      expect(m.updateData().returnedVerifiedAt).toBeInstanceOf(Date);
      expect(m.updateData().returnedVerifiedBy).toBe('p1');
      expect(m.history()[0]).toMatchObject({
        action: 'returned-verified',
        fromStatus: SampleStatus.RETURNED,
        toStatus: SampleStatus.RETURNED,
      });
    });

    it('refuses a sample that is not Returned', async () => {
      const m = build({ status: SampleStatus.DISCARDED });
      await expect(verify(m)).rejects.toBeInstanceOf(
        SampleFlagNotAllowedException,
      );
    });

    it('refuses a sample that is already verified (the first verifier stays on record)', async () => {
      const m = build({
        status: SampleStatus.RETURNED,
        returnedVerifiedAt: new Date(),
      });
      const refusal = await verify(m).catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(SampleFlagNotAllowedException);
      expect(refusalMessage(refusal as SampleFlagNotAllowedException)).toBe(
        'This returned sample is already marked as verified.',
      );
      expect(m.tx.orderSample.update).not.toHaveBeenCalled();
    });

    it("refuses a cancelled order's sample", async () => {
      const m = build({ status: SampleStatus.RETURNED }, true);
      await expect(verify(m)).rejects.toBeInstanceOf(
        SampleOrderCancelledException,
      );
    });
  });
});
