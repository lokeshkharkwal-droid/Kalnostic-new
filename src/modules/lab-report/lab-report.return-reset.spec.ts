import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';

/** The first argument of a mock's first call, typed (jest mocks are `any`). */
function firstArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0]?.[0] as T;
}
type WithWhere = { where: { status: { in: LabReportStatus[] } } };
type WithData = { data: Record<string, unknown> };

/**
 * A transferred test sent back for a repeat: allowed below Result Done, and the
 * report is reset for the sending branch.
 */
function build() {
  const tx = {
    labReport: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    labReportResultValue: { updateMany: jest.fn().mockResolvedValue({}) },
    reRunRequest: { updateMany: jest.fn().mockResolvedValue({}) },
    criticalAlert: { updateMany: jest.fn().mockResolvedValue({}) },
    outOfRangeFlag: { updateMany: jest.fn().mockResolvedValue({}) },
    deltaCheck: { updateMany: jest.fn().mockResolvedValue({}) },
    scheduledTest: { updateMany: jest.fn().mockResolvedValue({}) },
    multiStepTestProcess: { updateMany: jest.fn().mockResolvedValue({}) },
    labReportHistory: { create: jest.fn().mockResolvedValue({}) },
    labReportOverallResult: { updateMany: jest.fn().mockResolvedValue({}) },
    labReportNote: {
      updateMany: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn(),
    },
    labReportAttachment: {
      updateMany: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn(),
    },
    tatAdjustment: { updateMany: jest.fn().mockResolvedValue({}) },
    labReportInventoryUsage: { updateMany: jest.fn(), deleteMany: jest.fn() },
  };
  const service = Object.create(LabReportService.prototype) as LabReportService;
  return { service, tx };
}

describe('LabReportService.canReturnToSender', () => {
  it('is true when no report has a validated result', async () => {
    const { service, tx } = build();
    await expect(
      service.canReturnToSender(tx as never, 't1', ['r1', 'r2']),
    ).resolves.toBe(true);
  });

  it('asks only about Result Done, Approved and Published', async () => {
    const { service, tx } = build();
    await service.canReturnToSender(tx as never, 't1', ['r1']);
    const { where } = firstArg<WithWhere>(tx.labReport.findFirst);
    expect(where.status.in).toEqual([
      LabReportStatus.RESULT_DONE,
      LabReportStatus.APPROVED,
      LabReportStatus.PUBLISHED,
    ]);
  });

  it('is false when one report is validated', async () => {
    const { service, tx } = build();
    tx.labReport.findFirst.mockResolvedValue({ id: 'r2' });
    await expect(
      service.canReturnToSender(tx as never, 't1', ['r1', 'r2']),
    ).resolves.toBe(false);
  });

  it('is true for no reports and does not query', async () => {
    const { service, tx } = build();
    await expect(
      service.canReturnToSender(tx as never, 't1', []),
    ).resolves.toBe(true);
    expect(tx.labReport.findFirst).not.toHaveBeenCalled();
  });
});

describe('LabReportService.resetReportsForReturn', () => {
  it('clears values and worklist entries, resets the report and removes the lock', async () => {
    const { service, tx } = build();
    tx.labReport.findMany.mockResolvedValue([
      { id: 'r1', status: LabReportStatus.SAVED },
    ]);
    await service.resetReportsForReturn(tx as never, 't1', ['r1'], 'u1');

    const soft = { deletedAt: expect.any(Date) as Date };
    const byReport = { labReportId: { in: ['r1'] }, deletedAt: null };
    for (const model of [
      tx.labReportResultValue,
      tx.reRunRequest,
      tx.criticalAlert,
      tx.outOfRangeFlag,
      tx.deltaCheck,
      tx.scheduledTest,
      tx.multiStepTestProcess,
      tx.labReportOverallResult,
      tx.labReportAttachment,
      tx.tatAdjustment,
    ]) {
      expect(model.updateMany).toHaveBeenCalledWith({
        where: byReport,
        data: soft,
      });
    }
    const { data } = firstArg<WithData>(tx.labReport.updateMany);
    expect(data).toMatchObject({
      status: LabReportStatus.PENDING,
      savedAt: null,
      submittedAt: null,
      validatedAt: null,
      approvedAt: null,
      publishedAt: null,
      tatStartAt: null,
      tatBand: null,
      reportingDeferredUntil: null,
      isLocked: false,
      lockedAt: null,
      lockedBy: null,
      lockNotes: null,
    });
  });

  it('clears the five Notes-section texts', async () => {
    const { service, tx } = build();
    tx.labReport.findMany.mockResolvedValue([
      { id: 'r1', status: LabReportStatus.SAVED },
    ]);
    await service.resetReportsForReturn(tx as never, 't1', ['r1'], 'u1');
    expect(firstArg<WithData>(tx.labReport.updateMany).data).toMatchObject({
      usefulFor: null,
      interpretationOfResults: null,
      limitations: null,
      remarks: null,
      references: null,
    });
  });

  it('clears the saved choice of which Notes sections print (all five print again)', async () => {
    const { service, tx } = build();
    tx.labReport.findMany.mockResolvedValue([
      { id: 'r1', status: LabReportStatus.SAVED },
    ]);
    await service.resetReportsForReturn(tx as never, 't1', ['r1'], 'u1');
    expect(firstArg<WithData>(tx.labReport.updateMany).data).toMatchObject({
      excludedNoteSections: [],
    });
  });

  it('soft-deletes the technician and automatic notes but never ORDER or SAMPLE notes', async () => {
    const { service, tx } = build();
    tx.labReport.findMany.mockResolvedValue([
      { id: 'r1', status: LabReportStatus.SAVED },
    ]);
    await service.resetReportsForReturn(tx as never, 't1', ['r1'], 'u1');
    expect(tx.labReportNote.updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = firstArg<{
      where: { category: { in: string[] }; deletedAt: null };
      data: { deletedAt: Date };
    }>(tx.labReportNote.updateMany);
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(where.deletedAt).toBeNull();
    expect(where.category.in).toEqual(
      expect.arrayContaining([
        'TECH',
        'LOCK',
        'DELTA',
        'CRITICAL_ALERT',
        'OUT_OF_RANGE',
        'RE_RUN',
        'SCHEDULE',
        'ERROR_REPORTED',
        'RESULT_REJECTED',
        'UPDATE_STATUS',
        'MULTI_STEP',
      ]),
    );
    expect(where.category.in).not.toContain('ORDER');
    expect(where.category.in).not.toContain('SAMPLE');
  });

  it('never touches reagent usage and never hard-deletes anything', async () => {
    const { service, tx } = build();
    tx.labReport.findMany.mockResolvedValue([
      { id: 'r1', status: LabReportStatus.SAVED },
    ]);
    await service.resetReportsForReturn(tx as never, 't1', ['r1'], 'u1');
    expect(tx.labReportInventoryUsage.updateMany).not.toHaveBeenCalled();
    expect(tx.labReportInventoryUsage.deleteMany).not.toHaveBeenCalled();
    expect(tx.labReportNote.deleteMany).not.toHaveBeenCalled();
    expect(tx.labReportAttachment.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps the text of the cleared fields on the history line', async () => {
    const { service, tx } = build();
    tx.labReport.findMany.mockResolvedValue([
      {
        id: 'r1',
        status: LabReportStatus.VALIDATION_PENDING,
        usefulFor: 'screening',
        interpretationOfResults: null,
        limitations: 'haemolysed',
        remarks: null,
        references: null,
      },
    ]);
    await service.resetReportsForReturn(tx as never, 't1', ['r1'], 'u1');
    const { data } = firstArg<{ data: { notes?: string } }>(
      tx.labReportHistory.create,
    );
    expect(data.notes).toBe(
      'Cleared for the repeat — Useful for: screening; Limitations: haemolysed',
    );
  });

  it('writes no history note when there was nothing to clear', async () => {
    const { service, tx } = build();
    tx.labReport.findMany.mockResolvedValue([
      {
        id: 'r1',
        status: LabReportStatus.SAVED,
        usefulFor: null,
        interpretationOfResults: null,
        limitations: null,
        remarks: null,
        references: null,
      },
    ]);
    await service.resetReportsForReturn(tx as never, 't1', ['r1'], 'u1');
    const { data } = firstArg<{ data: { notes?: string } }>(
      tx.labReportHistory.create,
    );
    expect(data.notes).toBeUndefined();
  });

  it.each([
    LabReportStatus.PENDING,
    LabReportStatus.SAVED,
    LabReportStatus.VALIDATION_PENDING,
    LabReportStatus.ERROR_REPORTED,
    LabReportStatus.RESULT_REJECTED,
  ])('writes one returned_for_repeat history row from %s', async (status) => {
    const { service, tx } = build();
    tx.labReport.findMany.mockResolvedValue([{ id: 'r1', status }]);
    await service.resetReportsForReturn(tx as never, 't1', ['r1'], 'u1');
    expect(tx.labReportHistory.create).toHaveBeenCalledTimes(1);
    expect(firstArg<WithData>(tx.labReportHistory.create).data).toMatchObject({
      tenantId: 't1',
      labReportId: 'r1',
      fromStatus: status,
      toStatus: LabReportStatus.PENDING,
      action: 'returned_for_repeat',
      actorId: 'u1',
    });
  });

  it('records the system as the actor when nobody is named', async () => {
    const { service, tx } = build();
    tx.labReport.findMany.mockResolvedValue([
      { id: 'r1', status: LabReportStatus.SAVED },
    ]);
    await service.resetReportsForReturn(tx as never, 't1', ['r1'], null);
    expect(firstArg<WithData>(tx.labReportHistory.create).data.actorId).toBe(
      'system',
    );
  });

  it('does nothing for no reports', async () => {
    const { service, tx } = build();
    await service.resetReportsForReturn(tx as never, 't1', [], 'u1');
    expect(tx.labReport.updateMany).not.toHaveBeenCalled();
    expect(tx.labReportHistory.create).not.toHaveBeenCalled();
  });
});
