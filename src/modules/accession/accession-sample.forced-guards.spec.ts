import { EventEmitter2 } from '@nestjs/event-emitter';
import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import {
  SampleMoveBlockedByResultException,
  SampleRepeatMustBeCollectedException,
} from './exceptions/accession.exceptions';
import { AccessionSettingsService } from './accession-settings.service';
import { BarcodeService } from './barcode.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { AppointmentService } from '../appointment/appointment.service';

/**
 * A FORCED group action (the API still accepts `force`; the screen no longer sends it) must keep two rules the normal actions keep:
 *  - a tube waiting in Repeat can only be collected (or held) - a forced Accept would skip the Collect that makes its new barcode;
 *  - a tube whose result is validated cannot be pulled back to before its acceptance - the Approved report would be locked.
 */
function build(status: SampleStatus, validated: boolean) {
  const sample = {
    id: 's1',
    tenantId: 't1',
    branchId: 'A',
    status,
    previousStatus: null,
  };
  const update = jest.fn().mockResolvedValue({ ...sample });
  const lab = {
    findReportIdsForSampleTests: jest.fn().mockResolvedValue(['r1']),
    lockReports: jest.fn().mockResolvedValue(undefined),
    canReturnToSender: jest.fn().mockResolvedValue(!validated),
  };
  const tx = {
    orderSample: {
      findFirst: jest.fn().mockResolvedValue(sample),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update,
    },
    orderSampleStatusHistory: { create: jest.fn() },
    order: { findFirst: jest.fn().mockResolvedValue(null) },
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
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
  const run = (action: string, note: Record<string, unknown> = { force: true }) =>
    (
      service as unknown as {
        transitionInTx: (...a: unknown[]) => Promise<unknown>;
      }
    ).transitionInTx(tx, 't1', 'p1', 's1', action, () => ({ data: {} }), note);
  return { run, update, lab };
}

describe('forced actions on a tube waiting in Repeat', () => {
  it.each(['accept', 'acquire', 'halt', 'error', 'store', 'discard', 'send', 'forward', 'outsource'])(
    'a forced %s is refused: the tube must be collected first (nothing is written)',
    async (action) => {
      const m = build(SampleStatus.REPEAT, false);
      await expect(m.run(action)).rejects.toBeInstanceOf(
        SampleRepeatMustBeCollectedException,
      );
      expect(m.update).not.toHaveBeenCalled();
    },
  );

  it.each(['collect', 'hold'])('a forced %s of a Repeat tube still works', async (action) => {
    const m = build(SampleStatus.REPEAT, false);
    await m.run(action);
    expect(m.update).toHaveBeenCalledTimes(1);
  });

  it('the refusal carries a code a group "skip invalid" action can skip on', async () => {
    const m = build(SampleStatus.REPEAT, false);
    await expect(m.run('accept')).rejects.toMatchObject({
      errorCode: 'SAMPLE_REPEAT_MUST_BE_COLLECTED',
    });
  });

  it('the normal (non-forced) rules are untouched: accept from Repeat is refused by the table as before', async () => {
    const m = build(SampleStatus.REPEAT, false);
    await expect(m.run('accept', {})).rejects.toMatchObject({
      errorCode: 'INVALID_SAMPLE_TRANSITION',
    });
  });
});

describe('forced actions that pull a tube with a validated result back to before Accept', () => {
  it.each(['collect', 'acquire', 'halt', 'error', 'hold'])(
    'a forced %s of an Accepted tube whose result is validated is refused',
    async (action) => {
      const m = build(SampleStatus.ACCEPTED, true);
      await expect(m.run(action)).rejects.toBeInstanceOf(
        SampleMoveBlockedByResultException,
      );
      expect(m.update).not.toHaveBeenCalled();
    },
  );

  it('the refusal carries its own code', async () => {
    const m = build(SampleStatus.ACCEPTED, true);
    await expect(m.run('collect')).rejects.toMatchObject({
      errorCode: 'SAMPLE_MOVE_BLOCKED_RESULT_DONE',
    });
  });

  it('the same forced Collect is allowed while no result is validated', async () => {
    const m = build(SampleStatus.ACCEPTED, false);
    await m.run('collect');
    expect(m.update).toHaveBeenCalledTimes(1);
  });

  it('a forced move that does not go back before Accept never asks about the report (Store, Send ...)', async () => {
    const m = build(SampleStatus.ACCEPTED, true);
    await m.run('store');
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.lab.canReturnToSender).not.toHaveBeenCalled();
  });

  it('a tube already before Accept moving to another status before Accept is not judged (Collected -> Hold)', async () => {
    const m = build(SampleStatus.COLLECTED, true);
    await m.run('hold');
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.lab.canReturnToSender).not.toHaveBeenCalled();
  });
});
