import { CriticalAlertService } from './critical-alert.service';
import {
  LabReportLockedException,
  LabReportNotFoundException,
  LabReportSentOutException,
} from './exceptions/lab-report.exceptions';
import { assertReportWritable } from './utils/sent-out-report.util';

// The write-lock helper (sent out / cancelled order / awaiting sample) has its own
// spec; here it is a stub so this spec is only about the technician's Lock.
jest.mock('./utils/sent-out-report.util', () => ({
  assertReportWritable: jest.fn(),
}));

/**
 * A locked test is frozen. The screen disables "Inform Critical Alert" on it, and
 * the server must refuse it too — a direct API call used to slip through. It sits
 * next to the write locks (sent out / cancelled order), which are checked first.
 */
describe('CriticalAlertService.raise — locked reports', () => {
  const findFirst = jest.fn();
  const transaction = jest.fn();
  const recordWorklistHistory = jest.fn();
  const writable = jest.mocked(assertReportWritable);
  const service = new CriticalAlertService(
    // `withTenant` (not a bare `$transaction`): the write must run with the tenant set, or row-level security refuses it.
    { labReport: { findFirst }, withTenant: transaction } as never,
    { recordWorklistHistory } as never,
  );
  const raise = () =>
    service.raise('r1', 'tenant-1', 'branch-1', 'person-1', {
      notes: 'high K',
    });

  beforeEach(() => {
    [findFirst, transaction, recordWorklistHistory].forEach((m) =>
      m.mockReset(),
    );
    writable.mockReset().mockResolvedValue(undefined);
    transaction.mockResolvedValue({ id: 'alert-1' });
  });

  it('refuses a locked report and creates nothing', async () => {
    findFirst.mockResolvedValue({
      id: 'r1',
      isLocked: true,
      status: 'PENDING',
    });
    await expect(raise()).rejects.toBeInstanceOf(LabReportLockedException);
    expect(transaction).not.toHaveBeenCalled();
    expect(recordWorklistHistory).not.toHaveBeenCalled();
  });

  it('still raises the alert on an unlocked report', async () => {
    findFirst.mockResolvedValue({
      id: 'r1',
      isLocked: false,
      status: 'PENDING',
    });
    await expect(raise()).resolves.toEqual({ id: 'alert-1' });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(recordWorklistHistory).toHaveBeenCalledWith(
      'tenant-1',
      'r1',
      'critical_alert_raised',
      'person-1',
      'high K',
    );
  });

  it('still reports a missing report as not found', async () => {
    findFirst.mockResolvedValue(null);
    await expect(raise()).rejects.toBeInstanceOf(LabReportNotFoundException);
  });

  it('refuses a sent-out report (write lock) and creates nothing', async () => {
    findFirst.mockResolvedValue({
      id: 'r1',
      isLocked: false,
      status: 'PENDING',
    });
    writable.mockRejectedValue(new LabReportSentOutException('r1'));
    await expect(raise()).rejects.toBeInstanceOf(LabReportSentOutException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('checks the write locks first, then the technician Lock', async () => {
    findFirst.mockResolvedValue({
      id: 'r1',
      isLocked: true,
      status: 'PENDING',
    });
    writable.mockRejectedValue(new LabReportSentOutException('r1'));
    await expect(raise()).rejects.toBeInstanceOf(LabReportSentOutException);
    expect(writable).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'r1');
  });
});
