import { LabReportStatus } from '@prisma/client';
import {
  PRINTABLE_REPORT_STATUSES,
  RESULT_PENDING_TEXT,
  UNFINISHED_REPORT_STATUSES,
  isReportPrintable,
  pendingResultRow,
} from './print-visibility.util';

describe('print visibility', () => {
  it.each([
    LabReportStatus.RESULT_DONE,
    LabReportStatus.APPROVED,
    LabReportStatus.PUBLISHED,
  ])('%s results may be printed', (status) => {
    expect(isReportPrintable(status)).toBe(true);
  });

  it.each([
    LabReportStatus.PENDING,
    LabReportStatus.PARTIAL_PENDING,
    LabReportStatus.SAVED,
    LabReportStatus.VALIDATION_PENDING,
    LabReportStatus.RESULT_REJECTED,
    LabReportStatus.ERROR_REPORTED,
  ])(
    '%s results are not signed off, so they print as "Result pending"',
    (status) => {
      expect(isReportPrintable(status)).toBe(false);
    },
  );

  it('every status is one or the other (a new status cannot slip through unprinted-or-printed by accident)', () => {
    const all = Object.values(LabReportStatus);
    expect(
      [...PRINTABLE_REPORT_STATUSES, ...UNFINISHED_REPORT_STATUSES].sort(),
    ).toEqual([...all].sort());
  });

  it('the placeholder row carries the test name and no value at all', () => {
    const row = pendingResultRow('Thyroid profile');
    expect(row.parameter_name).toBe('Thyroid profile');
    expect(row.observed1).toBe(RESULT_PENDING_TEXT);
    expect(row.observed2).toBe('');
    expect(row.unit).toBe('');
    expect(row.reference_display).toBe('');
    expect(row.overall_result).toBe('');
  });

  it('the placeholder row has the same keys as a real result row, so templates need no change', () => {
    expect(Object.keys(pendingResultRow('x')).sort()).toEqual(
      [
        'parameter_name',
        'observed1',
        'observed2',
        'unit',
        'methodology',
        'method_name',
        'reference_display',
        'group_name',
        'result_note',
        'overall_result',
      ].sort(),
    );
  });
});
