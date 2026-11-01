import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import type { NotesPrintSwitches } from '../technician-settings/technician-settings.service';
import type { NotesSwitchCache } from './utils/note-sections.util';

/**
 * Choosing which Notes sections print: the technician leaves sections out per
 * report (checkbox beside each section). The Lab Test switch applies to a single
 * test, the Lab Panel switch to a report on a panel order line; both are read
 * from the branch that HOLDS the report. While the switch is off everything
 * prints, as before.
 */
// Real print-context building per case; a busy machine needs more than Jest's default 5 seconds.
jest.setTimeout(30_000);

type Ctx = { variables: Record<string, string> };
const SECTION_KEYS = [
  'useful_for',
  'interpretation',
  'limitations',
  'remarks',
  'references',
] as const;

const ALL_ON: NotesPrintSwitches = { labTest: true, labPanel: true };

function report(
  over: {
    kind?: 'TEST' | 'PANEL' | 'DIRECT';
    excluded?: string[];
    /** Whether a choice was saved; by default one exists exactly when `excluded` is given. */
    chosen?: boolean;
    branchId?: string | null;
    status?: LabReportStatus;
  } = {},
) {
  const kind = over.kind ?? 'TEST';
  return {
    id: 'r1',
    status: over.status ?? LabReportStatus.APPROVED,
    branchId: over.branchId === undefined ? 'A' : over.branchId,
    orderItemId: 'item1',
    excludedNoteSections: over.excluded ?? [],
    hasChosenNotePrint: over.chosen ?? over.excluded !== undefined,
    orderItem: {
      direct: kind === 'DIRECT' ? 'Free text' : null,
      branchLabPanelId: kind === 'PANEL' ? 'panel1' : null,
      branchLabTestId: kind === 'TEST' ? 'test1' : null,
      branchLabTest: kind === 'TEST' ? { testName: 'TSH' } : null,
      branchLabPanel: kind === 'PANEL' ? { panelName: 'Thyroid panel' } : null,
      order: {
        id: 'o1',
        orderCode: 'ORD-1',
        orderDate: new Date('2026-10-01'),
        orderTime: null,
        createdAt: new Date('2026-10-01T05:00:00.000Z'),
        externalOrderId: null,
        orderIdBarcode: null,
        orderIdQrCode: null,
        referredByDoctor: null,
        referralPanel: null,
        patient: {
          firstName: 'Rahul',
          middleName: null,
          lastName: 'Kumar',
          salutation: null,
          dateOfBirth: null,
          age: 30,
          ageType: 'YEARS',
          gender: null,
          umId: null,
          mobile: null,
          addressLine1: null,
          photoUrl: null,
        },
      },
    },
    parameterNotes: [],
    contentSections: {
      usefulFor: 'U-text',
      interpretation: 'I-text',
      limitations: 'L-text',
      remarks: 'R-text',
      references: 'F-text',
    },
    attachments: [],
    resultValues: [],
  };
}

function makeService(
  rep: ReturnType<typeof report>,
  getSwitches: jest.Mock,
): LabReportService {
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    loadReportDetail: jest.fn().mockResolvedValue(rep),
    findById: jest.fn().mockResolvedValue(rep),
    resolveStoredSignatories: jest.fn().mockResolvedValue([]),
    resolveApprovingDoctor: jest.fn().mockResolvedValue(null),
    siblingReportIds: jest.fn().mockResolvedValue(['r1']),
    requireBranch: (b: string) => b,
    technicianSettingsService: { getNotesPrintSwitches: getSwitches },
    tenantService: {
      getLocale: jest.fn().mockResolvedValue({
        timezone: 'Asia/Kolkata',
        dateFormat: 'DD/MM/YYYY',
        timeFormat: 'HH:mm',
      }),
    },
    prisma: {
      orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
      orderDiagnostics: { findUnique: jest.fn().mockResolvedValue(null) },
      labReport: {
        aggregate: jest.fn().mockResolvedValue({ _max: { approvedAt: null } }),
      },
      labReportNote: { findFirst: jest.fn().mockResolvedValue(null) },
      labTestResultParam: { findMany: jest.fn().mockResolvedValue([]) },
      labReportOverallResult: { findMany: jest.fn().mockResolvedValue([]) },
    },
  });
  return svc;
}

const printed = (
  svc: LabReportService,
  opts: { maskUnfinished?: boolean; notesSwitches?: NotesSwitchCache } = {},
) =>
  svc.buildPrintContext(
    'r1',
    't1',
    'A',
    false,
    opts,
  ) as unknown as Promise<Ctx>;

describe('printing: Notes sections left out of a report', () => {
  it('a section the technician left out prints empty; the others are unchanged', async () => {
    const svc = makeService(
      report({ excluded: ['limitations', 'references'] }),
      jest.fn().mockResolvedValue(ALL_ON),
    );
    const { variables } = await printed(svc);
    expect(variables.limitations).toBe('');
    expect(variables.references).toBe('');
    expect(variables.useful_for).toBe('U-text');
    expect(variables.interpretation).toBe('I-text');
    expect(variables.remarks).toBe('R-text');
  });

  it('with nothing left out, all five sections print as before', async () => {
    const svc = makeService(report(), jest.fn().mockResolvedValue(ALL_ON));
    const { variables } = await printed(svc);
    for (const k of SECTION_KEYS) expect(variables[k]).not.toBe('');
  });

  it('with the Lab Test setting OFF and nobody having chosen, no section prints (the default is unselected)', async () => {
    const svc = makeService(
      report(),
      jest.fn().mockResolvedValue({ labTest: false, labPanel: true }),
    );
    const { variables } = await printed(svc);
    for (const k of SECTION_KEYS) expect(variables[k]).toBe('');
  });

  it('with the Lab Test setting OFF, the sections the technician selected print and the rest do not', async () => {
    // a saved choice lists what is LEFT OUT: here only Interpretation and Remarks were selected
    const svc = makeService(
      report({ excluded: ['useful_for', 'limitations', 'references'] }),
      jest.fn().mockResolvedValue({ labTest: false, labPanel: true }),
    );
    const { variables } = await printed(svc);
    expect(variables.interpretation).toBe('I-text');
    expect(variables.remarks).toBe('R-text');
    expect(variables.useful_for).toBe('');
    expect(variables.limitations).toBe('');
    expect(variables.references).toBe('');
  });

  it('with the setting ON the technician can unselect sections; the saved choice is what prints', async () => {
    const svc = makeService(
      report({ excluded: ['limitations'] }),
      jest.fn().mockResolvedValue(ALL_ON),
    );
    const { variables } = await printed(svc);
    expect(variables.limitations).toBe('');
    for (const k of SECTION_KEYS.filter((s) => s !== 'limitations'))
      expect(variables[k]).not.toBe('');
  });

  it('selecting every section with the setting OFF prints all five', async () => {
    const svc = makeService(
      report({ excluded: [] }),
      jest.fn().mockResolvedValue({ labTest: false, labPanel: false }),
    );
    const { variables } = await printed(svc);
    for (const k of SECTION_KEYS) expect(variables[k]).not.toBe('');
  });

  it('a report on a panel order line takes its DEFAULT from the Lab Panel setting, not the Lab Test one', async () => {
    const panelOn = makeService(
      report({ kind: 'PANEL' }),
      jest.fn().mockResolvedValue({ labTest: false, labPanel: true }),
    );
    for (const k of SECTION_KEYS)
      expect((await printed(panelOn)).variables[k]).not.toBe('');

    const panelOff = makeService(
      report({ kind: 'PANEL' }),
      jest.fn().mockResolvedValue({ labTest: true, labPanel: false }),
    );
    for (const k of SECTION_KEYS)
      expect((await printed(panelOff)).variables[k]).toBe('');
  });

  it('a saved choice on a panel report applies whatever the settings say', async () => {
    const left = ['interpretation'];
    for (const switches of [
      { labTest: false, labPanel: true },
      { labTest: true, labPanel: false },
    ]) {
      const svc = makeService(
        report({ kind: 'PANEL', excluded: left }),
        jest.fn().mockResolvedValue(switches),
      );
      const { variables } = await printed(svc);
      expect(variables.interpretation).toBe('');
      expect(variables.remarks).toBe('R-text');
    }
  });

  it("reads the switches of the branch that HOLDS the report, not the caller's", async () => {
    const getSwitches = jest.fn().mockResolvedValue(ALL_ON);
    const svc = makeService(report({ branchId: 'B' }), getSwitches);
    await printed(svc);
    expect(getSwitches).toHaveBeenCalledWith('t1', 'B');
  });

  it('a free-text line reads no settings and prints as before', async () => {
    const getSwitches = jest.fn();
    const svc = makeService(
      report({ kind: 'DIRECT', excluded: ['remarks'] }),
      getSwitches,
    );
    const { variables } = await printed(svc);
    expect(getSwitches).not.toHaveBeenCalled();
    expect(variables.remarks).toBe('R-text');
  });

  it('an unfinished report stays blank (masking still wins)', async () => {
    const svc = makeService(
      report({ status: LabReportStatus.SAVED }),
      jest.fn().mockResolvedValue(ALL_ON),
    );
    const { variables } = await printed(svc, { maskUnfinished: true });
    for (const k of SECTION_KEYS) expect(variables[k]).toBe('');
  });

  it('reads each branch once when many reports are printed together', async () => {
    const getSwitches = jest.fn().mockResolvedValue(ALL_ON);
    const svc = makeService(report(), getSwitches);
    const shared: NotesSwitchCache = new Map();
    await printed(svc, { notesSwitches: shared });
    await printed(svc, { notesSwitches: shared });
    expect(getSwitches).toHaveBeenCalledTimes(1);
  });
});

describe('updateNotePrintSections', () => {
  function updating(
    switches: NotesPrintSwitches,
    kind: 'TEST' | 'PANEL' | 'DIRECT',
  ) {
    const rep = report({ kind });
    const update = jest.fn().mockResolvedValue({});
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      requireBranch: (b: string) => b,
      requireReport: jest.fn().mockResolvedValue({
        id: 'r1',
        branchId: 'A',
        orderItemId: 'item1',
        excludedNoteSections: [],
        hasChosenNotePrint: false,
        status: LabReportStatus.SAVED,
      }),
      lockReportForWrite: jest.fn().mockResolvedValue(undefined),
      technicianSettingsService: {
        getNotesPrintSwitches: jest.fn().mockResolvedValue(switches),
      },
      prisma: {
        orderItem: {
          findFirst: jest.fn().mockResolvedValue({
            branchLabPanelId: rep.orderItem.branchLabPanelId,
            branchLabTestId: rep.orderItem.branchLabTestId,
          }),
        },
        labReport: { update },
        // The choice is written inside the report's row lock, which re-reads the status.
        withTenant: (
          _tenantId: string,
          fn: (t: {
            labReport: { findFirst: jest.Mock; update: jest.Mock };
          }) => Promise<void>,
        ) =>
          fn({
            labReport: {
              findFirst: jest
                .fn()
                .mockResolvedValue({ status: LabReportStatus.SAVED }),
              update,
            },
          }),
      },
    });
    return { svc, update };
  }

  it('saves the list cleaned up (known keys, canonical order, no duplicates)', async () => {
    const { svc, update } = updating(ALL_ON, 'TEST');
    const result = await svc.updateNotePrintSections('r1', 't1', 'A', {
      excludedSections: ['references', 'useful_for', 'references'],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        excludedNoteSections: ['useful_for', 'references'],
        hasChosenNotePrint: true,
      },
    });
    expect(result).toEqual({
      enabled: true,
      isPanelMember: false,
      excludedSections: ['useful_for', 'references'],
    });
  });

  it('an empty list is a real choice (every section selected) and is stored as one', async () => {
    const { svc, update } = updating(ALL_ON, 'PANEL');
    const result = await svc.updateNotePrintSections('r1', 't1', 'A', {
      excludedSections: [],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { excludedNoteSections: [], hasChosenNotePrint: true },
    });
    expect(result).toMatchObject({ enabled: true, isPanelMember: true });
  });

  it('works with the matching setting OFF too: the checkboxes are always offered and the choice is saved', async () => {
    const { svc, update } = updating(
      { labTest: false, labPanel: false },
      'TEST',
    );
    const result = await svc.updateNotePrintSections('r1', 't1', 'A', {
      excludedSections: ['useful_for', 'limitations', 'remarks', 'references'],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        excludedNoteSections: [
          'useful_for',
          'limitations',
          'remarks',
          'references',
        ],
        hasChosenNotePrint: true,
      },
    });
    expect(result).toEqual({
      enabled: true,
      isPanelMember: false,
      excludedSections: ['useful_for', 'limitations', 'remarks', 'references'],
    });
  });

  it('a free-text line has no Notes: nothing is offered and nothing is saved', async () => {
    const { svc, update } = updating(ALL_ON, 'DIRECT');
    const result = await svc.updateNotePrintSections('r1', 't1', 'A', {
      excludedSections: ['remarks'],
    });
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({
      enabled: false,
      isPanelMember: false,
      excludedSections: [],
    });
  });
});

describe('the screen state of the Print checkboxes (resolveNotesPrint through the report detail)', () => {
  const resolve = (
    rep: ReturnType<typeof report>,
    switches: NotesPrintSwitches,
  ) => {
    const svc = makeService(rep, jest.fn().mockResolvedValue(switches));
    return (
      svc as unknown as {
        resolveNotesPrint: (
          t: string,
          r: unknown,
        ) => Promise<{ enabled: boolean; excludedSections: string[] }>;
      }
    ).resolveNotesPrint('t1', rep);
  };
  const ALL_FIVE = [
    'useful_for',
    'interpretation',
    'limitations',
    'remarks',
    'references',
  ];

  it('Lab Test setting ON: checkboxes shown, every section selected by default', async () => {
    expect(await resolve(report(), ALL_ON)).toMatchObject({
      enabled: true,
      excludedSections: [],
    });
  });

  it('Lab Test setting OFF: checkboxes STILL shown, every section unselected by default', async () => {
    expect(
      await resolve(report(), { labTest: false, labPanel: true }),
    ).toMatchObject({
      enabled: true,
      excludedSections: ALL_FIVE,
    });
  });

  it('Lab Panel setting ON/OFF behaves the same for a report on a panel line', async () => {
    expect(
      await resolve(report({ kind: 'PANEL' }), {
        labTest: false,
        labPanel: true,
      }),
    ).toMatchObject({
      enabled: true,
      excludedSections: [],
    });
    expect(
      await resolve(report({ kind: 'PANEL' }), {
        labTest: true,
        labPanel: false,
      }),
    ).toMatchObject({
      enabled: true,
      excludedSections: ALL_FIVE,
    });
  });

  it('a saved choice wins over the default', async () => {
    expect(
      await resolve(report({ excluded: ['remarks'] }), {
        labTest: false,
        labPanel: false,
      }),
    ).toMatchObject({
      enabled: true,
      excludedSections: ['remarks'],
    });
  });

  it('a free-text line shows no checkboxes', async () => {
    expect(await resolve(report({ kind: 'DIRECT' }), ALL_ON)).toMatchObject({
      enabled: false,
      excludedSections: [],
    });
  });
});
