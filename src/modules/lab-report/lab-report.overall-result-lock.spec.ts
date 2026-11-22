import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { LabReportOverallResultNotEditableException } from './exceptions/lab-report.exceptions';
import { LAB_REPORT_RESULT_EDIT_STATUSES } from './entities/lab-report.entity';

/**
 * "Finished reports do not change": the Overall Result prints, so it is locked once the result is validated,
 * exactly like the result values and the Notes. Edit Report reopens the report when a change is really needed.
 * The status is checked before the write AND again under the report's row lock (a Submit + Validate may commit in
 * between).
 */
const EDITABLE: string[] = [...LAB_REPORT_RESULT_EDIT_STATUSES];

function build(opts: {
  status: string;
  statusUnderLock?: string;
  settingOn?: boolean;
}) {
  const upsert: jest.Mock = jest
    .fn()
    .mockResolvedValue({ templateId: null, content: 'new' });
  const findUnique: jest.Mock = jest
    .fn()
    .mockResolvedValue({ templateId: 'tpl', content: 'old' });
  const withTenant: jest.Mock = jest.fn();
  const prisma: {
    labReportOverallResult: { findUnique: jest.Mock; upsert: jest.Mock };
    labReport: { findFirst: jest.Mock };
    withTenant: jest.Mock;
  } = {
    labReportOverallResult: { findUnique, upsert },
    labReport: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ status: opts.statusUnderLock ?? opts.status }),
    },
    withTenant,
  };
  withTenant.mockImplementation(
    (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  const service = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(service, {
    prisma,
    requireBranch: (b: string) => b,
    requireReport: jest
      .fn()
      .mockResolvedValue({ id: 'r1', status: opts.status }),
    assertResultParamBelongsToReport: jest.fn().mockResolvedValue(undefined),
    lockReportForWrite: jest.fn().mockResolvedValue(undefined),
    technicianSettingsService: {
      getForBranch: jest
        .fn()
        .mockResolvedValue({ isOverallResultEditable: opts.settingOn ?? true }),
    },
    overallResultTemplateService: {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'tpl2', content: 'tpl text' }),
    },
  });
  return { service, upsert, prisma };
}

const edit = (m: ReturnType<typeof build>) =>
  m.service.updateOverallResult('r1', 't1', 'b1', 'p1', { content: 'new' });

describe('Overall Result of a finished report is locked', () => {
  it('the editable statuses are exactly Pending, Partial Pending and Saved', () => {
    expect([...EDITABLE].sort()).toEqual(
      ['PARTIAL_PENDING', 'PENDING', 'SAVED'].sort(),
    );
  });

  it.each(EDITABLE)('%s: the Overall Result is saved', async (status) => {
    const m = build({ status });
    await edit(m);
    expect(m.upsert).toHaveBeenCalledTimes(1);
  });

  const LOCKED = Object.values(LabReportStatus).filter(
    (s) => !EDITABLE.includes(s),
  );
  it('every other status of the enum is covered below', () => {
    expect([...LOCKED].sort()).toEqual(
      [
        'APPROVED',
        'ERROR_REPORTED',
        'PUBLISHED',
        'RESULT_DONE',
        'RESULT_REJECTED',
        'VALIDATION_PENDING',
      ].sort(),
    );
  });

  it.each(LOCKED)(
    '%s: refused with 409 LAB_REPORT_OVERALL_RESULT_NOT_EDITABLE and nothing is written',
    async (status) => {
      const m = build({ status });
      const failure: unknown = await edit(m).then(
        () => null,
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(
        LabReportOverallResultNotEditableException,
      );
      const err = failure as LabReportOverallResultNotEditableException;
      expect(err.getStatus()).toBe(409);
      expect(err.errorCode).toBe('LAB_REPORT_OVERALL_RESULT_NOT_EDITABLE');
      expect(err.context).toEqual({ id: 'r1', currentStatus: status });
      expect(m.upsert).not.toHaveBeenCalled();
      expect(m.prisma.withTenant).not.toHaveBeenCalled();
    },
  );

  it('applying a TEMPLATE to a finished report is refused too (same rule as editing the text)', async () => {
    const m = build({ status: 'RESULT_DONE' });
    await expect(
      m.service.updateOverallResult('r1', 't1', 'b1', 'p1', {
        templateId: 'tpl2',
      }),
    ).rejects.toBeInstanceOf(LabReportOverallResultNotEditableException);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it('a report that became Result Done UNDER the lock (a Validate won the race) is refused, nothing written', async () => {
    const m = build({ status: 'SAVED', statusUnderLock: 'RESULT_DONE' });
    await expect(edit(m)).rejects.toBeInstanceOf(
      LabReportOverallResultNotEditableException,
    );
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it('the write is made under the report row lock', async () => {
    const m = build({ status: 'SAVED' });
    await edit(m);
    expect(
      (m.service as unknown as { lockReportForWrite: jest.Mock })
        .lockReportForWrite,
    ).toHaveBeenCalledTimes(1);
  });

  it('with the branch setting OFF nothing is written and the stored text comes back, whatever the status (no error)', async () => {
    for (const status of ['SAVED', 'RESULT_DONE']) {
      const m = build({ status, settingOn: false });
      const out = await edit(m);
      expect(out).toMatchObject({ resultParamId: 'p1', content: 'old' });
      expect(m.upsert).not.toHaveBeenCalled();
    }
  });
});
