import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { LabReportResultsNotEditableException } from './exceptions/lab-report.exceptions';
import { LAB_REPORT_RESULT_EDIT_STATUSES } from './entities/lab-report.entity';

/**
 * Technician Reporting — `PATCH /lab-reports/:id/results` is only allowed while the report is Pending, Partial Pending
 * or Saved. A report that was submitted (Validation Pending) or has moved further keeps its values: the request is
 * refused with 409 LAB_REPORT_RESULTS_NOT_EDITABLE and nothing is read or written.
 */
const T = 't1';
const B = 'b1';
const ACTOR = 'person-1';
const P1 = '11111111-1111-4111-8111-111111111111';
const EDITABLE: string[] = ['PENDING', 'PARTIAL_PENDING', 'SAVED'];

function build(status: string) {
  const labReportResultValue = {
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
    upsert: jest.fn().mockResolvedValue({}),
  };
  // `findFirst` answers two questions: the write lock's "is this report's order
  // cancelled?" probe (it is not) and the report lookup itself.
  const reportRow = {
    id: 'r1',
    orderItemId: 'oi1',
    labTestId: 'lt1',
    isLocked: false,
    status,
  };
  const labReportFindFirst = jest.fn(
    ({ where }: { where?: { orderItem?: unknown } }) =>
      Promise.resolve(where?.orderItem ? null : reportRow),
  );
  const tx = {
    labReportResultValue,
    labReportHistory: { create: jest.fn().mockResolvedValue({}) },
    labAdapter: { findMany: jest.fn().mockResolvedValue([]) },
    // The write lock locks the report row first, then re-checks it is writable.
    $queryRaw: jest.fn().mockResolvedValue([]),
    labReport: { findFirst: labReportFindFirst },
  };
  const prisma = {
    labReport: { findFirst: labReportFindFirst },
    orderSampleTest: { findFirst: jest.fn().mockResolvedValue({ id: 's' }) },
    orderItem: {
      findUnique: jest.fn().mockResolvedValue({ branchLabPanelId: null }),
    },
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  // The lab's time zone is read once per save (for the "when the analyzer sent it" text of the Audit Trail), after the status check.
  const tenantService = {
    getLocale: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
  };
  const deps = Array(11).fill(undefined) as unknown[];
  deps[0] = prisma;
  deps[7] = tenantService;
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  const internals = service as unknown as Record<string, jest.Mock>;
  internals.getResultParams = jest
    .fn()
    .mockResolvedValue([{ id: P1, parameterName: 'Hemoglobin' }]);
  internals.recomputeCalculatedValues = jest.fn().mockResolvedValue(undefined);
  internals.findByIdForApi = jest.fn().mockResolvedValue({ id: 'r1' });
  return { service, prisma, labReportResultValue, internals, tenantService };
}

const save = (m: ReturnType<typeof build>) =>
  m.service.upsertResultValues(
    'r1',
    T,
    B,
    { values: [{ resultParamId: P1, observed1: '13.5' }] },
    ACTOR,
  );

describe('upsertResultValues — which report statuses allow a value change', () => {
  it('the allowed statuses are exactly Pending, Partial Pending and Saved', () => {
    expect([...LAB_REPORT_RESULT_EDIT_STATUSES].sort()).toEqual(
      [...EDITABLE].sort(),
    );
  });

  it.each(EDITABLE)('%s: the value is saved', async (status) => {
    const m = build(status);
    await save(m);
    expect(m.labReportResultValue.upsert).toHaveBeenCalledTimes(1);
  });

  const REFUSED = Object.values(LabReportStatus).filter(
    (s) => !EDITABLE.includes(s),
  );
  it('every other status of the enum is covered by the refusal cases below', () => {
    expect([...REFUSED].sort()).toEqual(
      [
        'VALIDATION_PENDING',
        'RESULT_DONE',
        'APPROVED',
        'PUBLISHED',
        'ERROR_REPORTED',
        'RESULT_REJECTED',
      ].sort(),
    );
  });

  it.each(REFUSED)(
    '%s: refused with 409 LAB_REPORT_RESULTS_NOT_EDITABLE, nothing read or written',
    async (status) => {
      const m = build(status);
      const failure: unknown = await save(m).then(
        () => null,
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(LabReportResultsNotEditableException);
      const err = failure as LabReportResultsNotEditableException;
      expect(err.getStatus()).toBe(409);
      expect(err.errorCode).toBe('LAB_REPORT_RESULTS_NOT_EDITABLE');
      expect(err.context).toEqual({ id: 'r1', currentStatus: status });
      expect(m.prisma.withTenant).not.toHaveBeenCalled();
      expect(m.labReportResultValue.upsert).not.toHaveBeenCalled();
      expect(m.labReportResultValue.update).not.toHaveBeenCalled();
      expect(m.labReportResultValue.findMany).not.toHaveBeenCalled();
      expect(m.internals.getResultParams).not.toHaveBeenCalled();
      expect(m.tenantService.getLocale).not.toHaveBeenCalled();
    },
  );

  it('the message names the status in plain words and what is allowed', async () => {
    const m = build('VALIDATION_PENDING');
    const failure = (await save(m).then(
      () => null,
      (e: unknown) => e,
    )) as LabReportResultsNotEditableException;
    expect(failure.getResponse()).toEqual({
      success: false,
      error: {
        code: 'LAB_REPORT_RESULTS_NOT_EDITABLE',
        message:
          'Results can no longer be changed: this report is Validation Pending. Results can only be changed while the report is Pending, Partial Pending or Saved.',
      },
    });
  });

  it('an unknown future status is refused (only the three listed statuses are ever allowed)', async () => {
    const m = build('SOMETHING_NEW');
    await expect(save(m)).rejects.toBeInstanceOf(
      LabReportResultsNotEditableException,
    );
  });
});
