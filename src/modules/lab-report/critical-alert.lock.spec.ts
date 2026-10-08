import { CriticalAlertService } from './critical-alert.service';
import {
  LabReportLockedException,
  LabReportNotFoundException,
} from './exceptions/lab-report.exceptions';

/**
 * A locked test is frozen. The screen disables "Inform Critical Alert" on it, and
 * the server must refuse it too — a direct API call used to slip through.
 */
describe('CriticalAlertService.raise — locked reports', () => {
  const findFirst = jest.fn();
  const transaction = jest.fn();
  const recordWorklistHistory = jest.fn();
  const service = new CriticalAlertService(
    { labReport: { findFirst }, $transaction: transaction } as never,
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
});
