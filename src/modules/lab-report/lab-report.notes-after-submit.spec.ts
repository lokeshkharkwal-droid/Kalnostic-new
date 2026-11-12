import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { LabReportParameterNoteNotEditableException } from './exceptions/lab-report.exceptions';
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
 * The five Notes sections (useful for, interpretation, limitations, remarks, references) and the Print choice
 * beside them, like a parameter Note:
 *  - can be changed only while the report is Pending, Partial Pending or Saved (a later edit would silently
 *    change every later print);
 *  - are started over by Re-run: the configured notes show again, every section prints again, and the
 *    technician's parameter Notes are cleared.
 */
jest.setTimeout(30_000);

type Status = LabReportStatus;

function makeService(status: Status, freshStatus: Status = status) {
  const update = jest.fn().mockResolvedValue({});
  const tx = {
    labReport: {
      findFirst: jest.fn().mockResolvedValue({ status: freshStatus }),
      update,
    },
  };
  const lockReportForWrite = jest.fn().mockResolvedValue(undefined);
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    requireBranch: (b: string) => b,
    requireReport: jest.fn().mockResolvedValue({
      id: 'r1',
      status,
      branchId: 'A',
      labTestId: 'lt1',
      orderItemId: 'item1',
      excludedNoteSections: [],
      hasChosenNotePrint: false,
    }),
    lockReportForWrite,
    technicianSettingsService: {
      getForBranch: jest.fn().mockResolvedValue({
        isUsefulForEditable: true,
        isInterpretationEditable: true,
        isLimitationsEditable: true,
        isRemarksEditable: true,
        isReferencesEditable: true,
      }),
    },
    // After the write the method reads the report back; its content is not what these tests are about.
    getContentSections: jest.fn().mockResolvedValue({}),
    resolveNotesPrint: jest
      .fn()
      .mockResolvedValue({ enabled: true, excludedSections: [] }),
    prisma: {
      orderItem: {
        findFirst: jest.fn().mockResolvedValue({
          branchLabPanelId: null,
          branchLabTestId: 'bt1',
        }),
      },
      labReport: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          labTestId: 'lt1',
          usefulFor: null,
          interpretationOfResults: null,
          limitations: null,
          remarks: null,
          references: null,
        }),
      },
      withTenant: (_tenantId: string, fn: (t: typeof tx) => Promise<void>) =>
        fn(tx),
    },
  });
  return { svc, update, lockReportForWrite };
}

const EDITABLE = [
  LabReportStatus.PENDING,
  LabReportStatus.PARTIAL_PENDING,
  LabReportStatus.SAVED,
];
const MOVED_ON = [
  LabReportStatus.VALIDATION_PENDING,
  LabReportStatus.RESULT_DONE,
  LabReportStatus.APPROVED,
  LabReportStatus.PUBLISHED,
];

describe('LabReportService.updateContentSections: only while the report can still be edited', () => {
  const edit = (svc: LabReportService) =>
    svc.updateContentSections('r1', 't1', 'A', { remarks: '<p>mine</p>' });

  it.each(EDITABLE)('saves the text while the report is %s', async (status) => {
    const { svc, update } = makeService(status);
    await edit(svc);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { remarks: '<p>mine</p>' },
    });
  });

  it.each(MOVED_ON)(
    'refuses once the report is %s, and writes nothing',
    async (status) => {
      const { svc, update } = makeService(status);
      await expect(edit(svc)).rejects.toBeInstanceOf(
        LabReportParameterNoteNotEditableException,
      );
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('reads the status again after locking the row: a Submit that committed in between is not overwritten', async () => {
    const { svc, update, lockReportForWrite } = makeService(
      LabReportStatus.SAVED,
      LabReportStatus.VALIDATION_PENDING,
    );
    await expect(edit(svc)).rejects.toBeInstanceOf(
      LabReportParameterNoteNotEditableException,
    );
    expect(lockReportForWrite).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('LabReportService.updateNotePrintSections: only while the report can still be edited', () => {
  const choose = (svc: LabReportService) =>
    svc.updateNotePrintSections('r1', 't1', 'A', {
      excludedSections: ['limitations'],
    });

  it.each(EDITABLE)(
    'saves the choice while the report is %s',
    async (status) => {
      const { svc, update } = makeService(status);
      await expect(choose(svc)).resolves.toMatchObject({
        excludedSections: ['limitations'],
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: {
          excludedNoteSections: ['limitations'],
          hasChosenNotePrint: true,
        },
      });
    },
  );

  it.each(MOVED_ON)(
    'refuses once the report is %s, and writes nothing',
    async (status) => {
      const { svc, update } = makeService(status);
      await expect(choose(svc)).rejects.toBeInstanceOf(
        LabReportParameterNoteNotEditableException,
      );
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('reads the status again after locking the row', async () => {
    const { svc, update } = makeService(
      LabReportStatus.SAVED,
      LabReportStatus.APPROVED,
    );
    await expect(choose(svc)).rejects.toBeInstanceOf(
      LabReportParameterNoteNotEditableException,
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('LabReportService.resetForRerun starts the notes over', () => {
  function makeRerun() {
    const tx = {
      labReportResultValue: { updateMany: jest.fn().mockResolvedValue({}) },
      labReportParameterNote: { updateMany: jest.fn().mockResolvedValue({}) },
      labReport: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ status: LabReportStatus.RESULT_DONE }),
        update: jest.fn().mockResolvedValue({ id: 'r1' }),
      },
    };
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      lockReportForWrite: jest.fn().mockResolvedValue(undefined),
      recordHistory: jest.fn().mockResolvedValue(undefined),
      prisma: {
        labReport: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'r1',
            status: LabReportStatus.RESULT_DONE,
            isLocked: false,
          }),
        },
        withTenant: (_t: string, fn: (t: typeof tx) => Promise<unknown>) =>
          fn(tx),
      },
    });
    return { svc, tx };
  }

  it("soft-deletes the technician's parameter Notes along with the result values", async () => {
    const { svc, tx } = makeRerun();
    await svc.resetForRerun('r1', 't1', 'A', 'p1');
    expect(tx.labReportResultValue.updateMany).toHaveBeenCalledWith({
      where: { labReportId: 'r1', deletedAt: null },
      data: { deletedAt: expect.any(Date) as Date },
    });
    expect(tx.labReportParameterNote.updateMany).toHaveBeenCalledWith({
      where: { labReportId: 'r1', deletedAt: null },
      data: { deletedAt: expect.any(Date) as Date },
    });
  });

  it('clears the five Notes sections and starts the Print choice over (the branch default decides again)', async () => {
    const { svc, tx } = makeRerun();
    await svc.resetForRerun('r1', 't1', 'A', 'p1');
    const arg = tx.labReport.update.mock.calls[0] as [
      { where: { id: string }; data: Record<string, unknown> },
    ];
    expect(arg[0].where).toEqual({ id: 'r1' });
    expect(arg[0].data).toMatchObject({
      usefulFor: null,
      interpretationOfResults: null,
      limitations: null,
      remarks: null,
      references: null,
      excludedNoteSections: [],
      hasChosenNotePrint: false,
      status: LabReportStatus.PENDING,
    });
  });
});

describe('approval freezes the default Print selection', () => {
  const ALL_FIVE = [
    'useful_for',
    'interpretation',
    'limitations',
    'remarks',
    'references',
  ];

  function makeFreeze(opts: {
    switches: { labTest: boolean; labPanel: boolean };
    line?: { branchLabPanelId: string | null; branchLabTestId: string | null };
  }) {
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      technicianSettingsService: {
        getNotesPrintSwitches: jest.fn().mockResolvedValue(opts.switches),
      },
      prisma: {
        orderItem: {
          findFirst: jest
            .fn()
            .mockResolvedValue(
              opts.line ?? { branchLabPanelId: null, branchLabTestId: 'bt1' },
            ),
        },
      },
    });
    return (report: {
      hasChosenNotePrint: boolean;
      excludedNoteSections?: string[];
    }) =>
      (
        svc as unknown as {
          freezeNotePrintChoice: (t: string, r: unknown) => Promise<unknown>;
        }
      ).freezeNotePrintChoice('t1', {
        orderItemId: 'item1',
        branchId: 'A',
        excludedNoteSections: report.excludedNoteSections ?? [],
        hasChosenNotePrint: report.hasChosenNotePrint,
      });
  }

  it('with the setting ON and no choice, approval stores "every section selected"', async () => {
    const freeze = makeFreeze({ switches: { labTest: true, labPanel: true } });
    await expect(freeze({ hasChosenNotePrint: false })).resolves.toEqual({
      excludedNoteSections: [],
      hasChosenNotePrint: true,
    });
  });

  it('with the setting OFF and no choice, approval stores "no section selected", so a later change of the setting cannot make it print', async () => {
    const freeze = makeFreeze({ switches: { labTest: false, labPanel: true } });
    await expect(freeze({ hasChosenNotePrint: false })).resolves.toEqual({
      excludedNoteSections: ALL_FIVE,
      hasChosenNotePrint: true,
    });
  });

  it('a report on a panel line freezes the Lab Panel default', async () => {
    const freeze = makeFreeze({
      switches: { labTest: true, labPanel: false },
      line: { branchLabPanelId: 'panel1', branchLabTestId: null },
    });
    await expect(freeze({ hasChosenNotePrint: false })).resolves.toEqual({
      excludedNoteSections: ALL_FIVE,
      hasChosenNotePrint: true,
    });
  });

  it('leaves a choice the technician already made alone', async () => {
    const freeze = makeFreeze({ switches: { labTest: true, labPanel: true } });
    await expect(
      freeze({ hasChosenNotePrint: true, excludedNoteSections: ['remarks'] }),
    ).resolves.toBeNull();
  });

  it('a free-text line has no Notes: nothing to freeze', async () => {
    const freeze = makeFreeze({
      switches: { labTest: true, labPanel: true },
      line: { branchLabPanelId: null, branchLabTestId: null },
    });
    await expect(freeze({ hasChosenNotePrint: false })).resolves.toBeNull();
  });
});
