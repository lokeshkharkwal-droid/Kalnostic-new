import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { ReRunService } from './re-run.service';
import { LAB_REPORT_ALLOWED_FROM } from './entities/lab-report.entity';
import {
  LabReportLockedException,
  LabReportRerunNotAllowedException,
} from './exceptions/lab-report.exceptions';
import { assertReportWritable } from './utils/sent-out-report.util';

// The write locks (sent out / cancelled order / awaiting sample) have their own spec.
jest.mock('./utils/sent-out-report.util', () => ({
  ...jest.requireActual<typeof import('./utils/sent-out-report.util')>(
    './utils/sent-out-report.util',
  ),
  assertReportWritable: jest.fn(),
}));
beforeEach(() => {
  jest.mocked(assertReportWritable).mockReset().mockResolvedValue(undefined);
});

/**
 * Re-run is allowed only from Result Done, Result Rejected and Error Reported (the manager's rule):
 *  - from Validation Pending the result is rejected first;
 *  - from Approved or Published an error is reported first;
 *  - Pending, Partial Pending and Saved have nothing to re-run.
 * The server enforces it, not only the screen, and re-checks the status after taking the row lock.
 */
const ALLOWED: LabReportStatus[] = [
  LabReportStatus.RESULT_DONE,
  LabReportStatus.RESULT_REJECTED,
  LabReportStatus.ERROR_REPORTED,
];
const REFUSED = Object.values(LabReportStatus).filter(
  (s) => !ALLOWED.includes(s),
);

function makeService(
  status: LabReportStatus,
  opts: { freshStatus?: LabReportStatus; locked?: boolean } = {},
) {
  const tx = {
    labReportResultValue: { updateMany: jest.fn().mockResolvedValue({}) },
    labReportParameterNote: { updateMany: jest.fn().mockResolvedValue({}) },
    labReport: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ status: opts.freshStatus ?? status }),
      update: jest.fn().mockResolvedValue({ id: 'r1' }),
    },
  };
  const recordHistory = jest.fn().mockResolvedValue(undefined);
  const withTenant = jest.fn(
    (_t: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  );
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    lockReportForWrite: jest.fn().mockResolvedValue(undefined),
    recordHistory,
    prisma: {
      labReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'r1',
          status,
          isLocked: opts.locked ?? false,
        }),
      },
      withTenant,
    },
  });
  return { svc, tx, recordHistory, withTenant };
}

describe('the allowed statuses for a Re-run', () => {
  it('are exactly Result Done, Result Rejected and Error Reported', () => {
    expect([...LAB_REPORT_ALLOWED_FROM.reRun].sort()).toEqual(
      [...ALLOWED].sort(),
    );
  });
});

describe('LabReportService.resetForRerun — status rule', () => {
  it.each(ALLOWED)('%s: the report goes back to Pending', async (status) => {
    const { svc, tx, recordHistory } = makeService(status);
    await svc.resetForRerun('r1', 't1', 'b1', 'p1');
    expect(tx.labReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LabReportStatus.PENDING,
        }) as Record<string, unknown>,
      }),
    );
    // the history names the status the report really had
    expect(recordHistory).toHaveBeenCalledWith(
      tx,
      't1',
      'r1',
      status,
      LabReportStatus.PENDING,
      're_run',
      'p1',
    );
  });

  it.each(REFUSED)(
    '%s: refused with LAB_REPORT_RERUN_NOT_ALLOWED and nothing is written',
    async (status) => {
      const { svc, tx, withTenant } = makeService(status);
      const err: unknown = await svc
        .resetForRerun('r1', 't1', 'b1', 'p1')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LabReportRerunNotAllowedException);
      expect(err).toMatchObject({
        errorCode: 'LAB_REPORT_RERUN_NOT_ALLOWED',
      });
      expect(withTenant).not.toHaveBeenCalled();
      expect(tx.labReportResultValue.updateMany).not.toHaveBeenCalled();
      expect(tx.labReport.update).not.toHaveBeenCalled();
    },
  );

  it('tells the technician what to do first, by status', async () => {
    const message = async (status: LabReportStatus): Promise<string> => {
      const err = (await makeService(status)
        .svc.resetForRerun('r1', 't1', 'b1', 'p1')
        .catch((e: unknown) => e)) as LabReportRerunNotAllowedException;
      // the text the screen shows is the one in the response body
      return (err.getResponse() as { error: { message: string } }).error
        .message;
    };
    expect(await message(LabReportStatus.VALIDATION_PENDING)).toContain(
      'Reject the result first',
    );
    expect(await message(LabReportStatus.APPROVED)).toContain('Error Reported');
    expect(await message(LabReportStatus.PUBLISHED)).toContain(
      'Error Reported',
    );
    expect(await message(LabReportStatus.SAVED)).toContain('Result Done');
  });

  it('a report approved a moment ago (after the first read) is not wiped', async () => {
    const { svc, tx } = makeService(LabReportStatus.RESULT_DONE, {
      freshStatus: LabReportStatus.APPROVED,
    });
    await expect(
      svc.resetForRerun('r1', 't1', 'b1', 'p1'),
    ).rejects.toBeInstanceOf(LabReportRerunNotAllowedException);
    expect(tx.labReportResultValue.updateMany).not.toHaveBeenCalled();
    expect(tx.labReport.update).not.toHaveBeenCalled();
  });

  it('a locked report is still refused as locked (the lock reason comes first)', async () => {
    const { svc } = makeService(LabReportStatus.SAVED, { locked: true });
    await expect(
      svc.resetForRerun('r1', 't1', 'b1', 'p1'),
    ).rejects.toBeInstanceOf(LabReportLockedException);
  });
});

describe('ReRunService.raise — nothing is recorded for a refused Re-run', () => {
  function makeRaise(resetRejects: boolean) {
    const create = jest.fn().mockResolvedValue({ id: 'rr1' });
    const resetForRerun = resetRejects
      ? jest
          .fn()
          .mockRejectedValue(
            new LabReportRerunNotAllowedException('r1', 'APPROVED', ALLOWED),
          )
      : jest.fn().mockResolvedValue(undefined);
    const recordWorklistHistory = jest.fn().mockResolvedValue(undefined);
    const svc = new ReRunService(
      {
        labReport: {
          findFirst: jest.fn().mockResolvedValue({ id: 'r1' }),
        },
        reRunRequest: { create },
      } as never,
      { resetForRerun, recordWorklistHistory } as never,
    );
    return { svc, create, resetForRerun, recordWorklistHistory };
  }

  it('a refused reset creates no Re-run request and no history line', async () => {
    const { svc, create, recordWorklistHistory } = makeRaise(true);
    await expect(
      svc.raise('r1', 't1', 'b1', 'p1', { notes: 'x' }),
    ).rejects.toBeInstanceOf(LabReportRerunNotAllowedException);
    expect(create).not.toHaveBeenCalled();
    expect(recordWorklistHistory).not.toHaveBeenCalled();
  });

  it('an allowed reset creates the request', async () => {
    const { svc, create } = makeRaise(false);
    await svc.raise('r1', 't1', 'b1', 'p1', { notes: 'x' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
