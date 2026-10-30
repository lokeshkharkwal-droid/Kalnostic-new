import { LabReportStatus } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { LabReportService } from './lab-report.service';
import type { NotesPrintSwitches } from '../technician-settings/technician-settings.service';
import type { NotesSwitchCache } from './utils/note-sections.util';

/**
 * Cases the first Notes-print spec (`lab-report.note-print-sections.spec.ts`) did
 * not drive:
 *  1. a panel order line backs SEVERAL reports (one per member test);
 *  2. an old combined panel report (no member test) on a panel order line;
 *  3. a report printed by a branch other than the one holding it (Registration).
 *
 * The rule under test: which switch applies comes from the ORDER LINE
 * (`orderItem.branchLabPanelId` set = Lab Panel, else Lab Test) and the switches
 * come from the branch that HOLDS the report, never from the branch pressing Print.
 */
// The Print All cases build real PDFs (pdf-lib); give a busy machine room.
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

interface Rep {
  id: string;
  status: LabReportStatus;
  branchId: string | null;
  orderItemId: string;
  memberBranchLabTestId: string | null;
  excludedNoteSections: string[];
  orderItem: Record<string, unknown>;
  parameterNotes: Array<{ resultParamId: string; content: string }>;
  contentSections: Record<string, string>;
  attachments: unknown[];
  resultValues: unknown[];
}

function report(
  over: {
    id?: string;
    kind?: 'TEST' | 'PANEL';
    excluded?: string[];
    branchId?: string | null;
    /** A panel member's own test; null = an old combined panel report. */
    member?: string | null;
  } = {},
): Rep {
  const kind = over.kind ?? 'TEST';
  return {
    id: over.id ?? 'r1',
    status: LabReportStatus.APPROVED,
    branchId: over.branchId === undefined ? 'A' : over.branchId,
    orderItemId: 'item1',
    memberBranchLabTestId: over.member === undefined ? null : over.member,
    excludedNoteSections: over.excluded ?? [],
    orderItem: {
      direct: null,
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

/** The service without its DI graph, serving the given reports by id. */
function makeService(
  reps: Rep | Rep[],
  getSwitches: jest.Mock,
): LabReportService {
  const all = Array.isArray(reps) ? reps : [reps];
  const byId = (id: string) => Promise.resolve(all.find((r) => r.id === id));
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    loadReportDetail: jest.fn(byId),
    findById: jest.fn(byId),
    resolveStoredSignatories: jest.fn().mockResolvedValue([]),
    resolveApprovingDoctor: jest.fn().mockResolvedValue(null),
    siblingReportIds: jest.fn().mockResolvedValue(all.map((r) => r.id)),
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

/** Print one report's context as `callerBranch` (the branch pressing Print). */
const printed = (
  svc: LabReportService,
  reportId = 'r1',
  callerBranch = 'A',
  notesSwitches?: NotesSwitchCache,
) =>
  svc.buildPrintContext(reportId, 't1', callerBranch, false, {
    notesSwitches,
  }) as unknown as Promise<Ctx>;

/** Switches by holding branch: `{ B: {labTest:false, labPanel:true}, A: ... }`. */
const switchesByBranch = (byBranch: Record<string, NotesPrintSwitches>) =>
  jest.fn((_tenant: string, branch: string) =>
    Promise.resolve(byBranch[branch] ?? ALL_ON),
  );

/** `updateNotePrintSections` wired to one stored report and one order line. */
function saving(
  switches: NotesPrintSwitches,
  line: { branchLabPanelId: string | null; branchLabTestId: string | null },
  stored: { id: string; memberBranchLabTestId?: string | null } = { id: 'r1' },
) {
  const update = jest.fn().mockResolvedValue({});
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    requireBranch: (b: string) => b,
    requireReport: jest.fn().mockResolvedValue({
      branchId: 'A',
      orderItemId: 'item1',
      excludedNoteSections: [],
      ...stored,
    }),
    technicianSettingsService: {
      getNotesPrintSwitches: jest.fn().mockResolvedValue(switches),
    },
    prisma: {
      orderItem: { findFirst: jest.fn().mockResolvedValue(line) },
      labReport: { update },
    },
  });
  return { svc, update };
}

const PANEL_LINE = { branchLabPanelId: 'panel1', branchLabTestId: null };

describe('a panel with several member tests', () => {
  const MEMBERS = ['m1', 'm2', 'm3', 'm4', 'm5'];
  const panelReports = (excluded: Record<string, string[]> = {}) =>
    MEMBERS.map((m) =>
      report({
        id: `r-${m}`,
        kind: 'PANEL',
        member: m,
        excluded: excluded[m] ?? [],
      }),
    );

  it('each member prints only the sections ITS OWN report left out', async () => {
    const svc = makeService(
      panelReports({
        m1: ['limitations'],
        m3: ['useful_for', 'remarks'],
        m5: [...SECTION_KEYS],
      }),
      jest.fn().mockResolvedValue(ALL_ON),
    );
    const out: Record<string, Record<string, string>> = {};
    for (const m of MEMBERS) out[m] = (await printed(svc, `r-${m}`)).variables;

    expect(out.m1!.limitations).toBe('');
    expect(out.m1!.useful_for).toBe('U-text');
    for (const k of SECTION_KEYS) expect(out.m2![k]).not.toBe(''); // untouched
    expect(out.m3!.useful_for).toBe('');
    expect(out.m3!.remarks).toBe('');
    expect(out.m3!.interpretation).toBe('I-text');
    expect(out.m4!.limitations).toBe('L-text');
    for (const k of SECTION_KEYS) expect(out.m5![k]).toBe(''); // all left out
  });

  it('every member follows the Lab Panel switch; the Lab Test switch is irrelevant', async () => {
    const reps = panelReports({ m1: ['remarks'], m2: ['references'] });
    const panelOn = makeService(
      reps,
      jest.fn().mockResolvedValue({ labTest: false, labPanel: true }),
    );
    expect((await printed(panelOn, 'r-m1')).variables.remarks).toBe('');
    expect((await printed(panelOn, 'r-m2')).variables.references).toBe('');

    const panelOff = makeService(
      reps,
      jest.fn().mockResolvedValue({ labTest: true, labPanel: false }),
    );
    for (const m of ['m1', 'm2']) {
      const { variables } = await printed(panelOff, `r-${m}`);
      for (const k of SECTION_KEYS) expect(variables[k]).not.toBe('');
    }
  });

  it('printing the whole panel together reads the switches once, not once per member', async () => {
    const getSwitches = jest.fn().mockResolvedValue(ALL_ON);
    const svc = makeService(panelReports(), getSwitches);
    const shared: NotesSwitchCache = new Map();
    for (const m of MEMBERS) await printed(svc, `r-${m}`, 'A', shared);
    expect(getSwitches).toHaveBeenCalledTimes(1);
  });

  it('in an order that mixes a panel and a single test, each line follows its own switch', async () => {
    const single = report({
      id: 'r-single',
      kind: 'TEST',
      excluded: ['remarks'],
    });
    const member = report({
      id: 'r-member',
      kind: 'PANEL',
      member: 'm1',
      excluded: ['remarks'],
    });
    const svc = makeService(
      [single, member],
      jest.fn().mockResolvedValue({ labTest: true, labPanel: false }),
    );
    const shared: NotesSwitchCache = new Map();
    // the single test honours the Lab Test switch (ON) ...
    expect(
      (await printed(svc, 'r-single', 'A', shared)).variables.remarks,
    ).toBe('');
    // ... the panel member the Lab Panel switch (OFF), so its remarks print
    expect(
      (await printed(svc, 'r-member', 'A', shared)).variables.remarks,
    ).toBe('R-text');
  });

  it('saving the choice on one member writes that report only', async () => {
    const { svc, update } = saving(ALL_ON, PANEL_LINE, { id: 'r-m1' });
    const result = await svc.updateNotePrintSections('r-m1', 't1', 'A', {
      excludedSections: ['interpretation'],
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r-m1' },
      data: { excludedNoteSections: ['interpretation'] },
    });
    expect(result).toMatchObject({ enabled: true, isPanelMember: true });
  });
});

describe('an old combined panel report (no member test)', () => {
  const old = (excluded: string[] = []) =>
    report({ kind: 'PANEL', member: null, excluded });

  it('follows the Lab Panel switch: ON, so the choice applies', async () => {
    const svc = makeService(
      old(['interpretation']),
      jest.fn().mockResolvedValue({ labTest: false, labPanel: true }),
    );
    const { variables } = await printed(svc);
    expect(variables.interpretation).toBe('');
    expect(variables.useful_for).toBe('U-text');
  });

  it('follows the Lab Panel switch: OFF, so everything prints (the Lab Test switch cannot rescue it)', async () => {
    const svc = makeService(
      old(['interpretation', 'remarks']),
      jest.fn().mockResolvedValue({ labTest: true, labPanel: false }),
    );
    const { variables } = await printed(svc);
    for (const k of SECTION_KEYS) expect(variables[k]).not.toBe('');
  });

  it('is a panel report to the screen; a save while the panel switch is off is refused', async () => {
    const { svc, update } = saving(
      { labTest: true, labPanel: false },
      PANEL_LINE,
      { id: 'r1', memberBranchLabTestId: null },
    );
    const result = await svc.updateNotePrintSections('r1', 't1', 'A', {
      excludedSections: ['remarks'],
    });
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({
      enabled: false,
      isPanelMember: true,
      excludedSections: [],
    });
  });

  it('a save while the panel switch is on is stored', async () => {
    const { svc, update } = saving(ALL_ON, PANEL_LINE, {
      id: 'r1',
      memberBranchLabTestId: null,
    });
    await svc.updateNotePrintSections('r1', 't1', 'A', {
      excludedSections: ['remarks'],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { excludedNoteSections: ['remarks'] },
    });
  });
});

describe('printing a report held by another branch (Registration)', () => {
  it('uses the HOLDER branch switches even when the caller branch has the opposite setting', async () => {
    const getSwitches = switchesByBranch({
      A: { labTest: false, labPanel: false }, // caller
      B: { labTest: true, labPanel: true }, // holder: the report was set up here
    });
    const svc = makeService(
      report({ branchId: 'B', excluded: ['limitations'] }),
      getSwitches,
    );
    const { variables } = await printed(svc, 'r1', 'A');
    expect(variables.limitations).toBe('');
    expect(getSwitches).toHaveBeenCalledTimes(1);
    expect(getSwitches).toHaveBeenCalledWith('t1', 'B');
  });

  it('prints everything when the HOLDER has the switch off, even if the caller has it on', async () => {
    const getSwitches = switchesByBranch({
      A: ALL_ON,
      B: { labTest: false, labPanel: false },
    });
    const svc = makeService(
      report({ branchId: 'B', excluded: ['limitations', 'remarks'] }),
      getSwitches,
    );
    const { variables } = await printed(svc, 'r1', 'A');
    for (const k of SECTION_KEYS) expect(variables[k]).not.toBe('');
  });

  it('the same report prints the same notes whichever branch presses Print', async () => {
    const svc = makeService(
      report({ branchId: 'B', excluded: ['references', 'useful_for'] }),
      jest.fn().mockResolvedValue(ALL_ON),
    );
    const fromRegistration = (await printed(svc, 'r1', 'A')).variables;
    const fromHolder = (await printed(svc, 'r1', 'B')).variables;
    const fromThird = (await printed(svc, 'r1', 'C')).variables;
    for (const k of SECTION_KEYS) {
      expect(fromRegistration[k]).toBe(fromHolder[k]);
      expect(fromThird[k]).toBe(fromHolder[k]);
    }
    expect(fromRegistration.references).toBe('');
    expect(fromRegistration.useful_for).toBe('');
  });

  it('a panel member held elsewhere follows the HOLDER Lab Panel switch', async () => {
    const getSwitches = switchesByBranch({
      A: { labTest: true, labPanel: false },
      B: { labTest: false, labPanel: true },
    });
    const svc = makeService(
      report({
        kind: 'PANEL',
        member: 'm1',
        branchId: 'B',
        excluded: ['interpretation'],
      }),
      getSwitches,
    );
    expect((await printed(svc, 'r1', 'A')).variables.interpretation).toBe('');
  });

  it('one document holding reports of two branches reads each branch once and keeps them apart', async () => {
    const getSwitches = switchesByBranch({
      A: { labTest: true, labPanel: true },
      B: { labTest: false, labPanel: true },
    });
    const svc = makeService(
      [
        report({ id: 'r-a', branchId: 'A', excluded: ['remarks'] }),
        report({ id: 'r-b', branchId: 'B', excluded: ['remarks'] }),
      ],
      getSwitches,
    );
    const shared: NotesSwitchCache = new Map();
    const a = await printed(svc, 'r-a', 'A', shared);
    const b = await printed(svc, 'r-b', 'A', shared);
    const again = await printed(svc, 'r-a', 'A', shared);
    expect(a.variables.remarks).toBe(''); // holder A: Lab Test ON
    expect(b.variables.remarks).toBe('R-text'); // holder B: Lab Test OFF
    expect(again.variables.remarks).toBe('');
    expect(getSwitches).toHaveBeenCalledTimes(2); // A once, B once
  });

  it('a report with no branch reads no setting and keeps the saved choice', async () => {
    const getSwitches = jest.fn();
    const svc = makeService(
      report({ branchId: null, excluded: ['remarks'] }),
      getSwitches,
    );
    const { variables } = await printed(svc);
    expect(getSwitches).not.toHaveBeenCalled();
    expect(variables.remarks).toBe('');
  });
});

describe('Print All hands every report one switch cache', () => {
  async function onePagePdf(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.addPage();
    return Buffer.from(await doc.save());
  }

  function printAllService(rows: Array<{ id: string; branchId: string }>) {
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      requireBranch: (b: string) => b,
      assertOrderNotCancelledForPrint: jest.fn().mockResolvedValue(undefined),
      canPrintWholeOrder: jest.fn().mockResolvedValue(true),
      referralCredit: {
        assertReportAccessAllowedByOrderId: jest
          .fn()
          .mockResolvedValue(undefined),
      },
      prisma: { labReport: { findMany: jest.fn().mockResolvedValue(rows) } },
    });
    return svc;
  }

  it('the same cache reaches every report, and each report is rendered as its HOLDER branch', async () => {
    const pdf = await onePagePdf();
    const svc = printAllService([
      { id: 'r-a1', branchId: 'A' },
      { id: 'r-b1', branchId: 'B' },
      { id: 'r-b2', branchId: 'B' },
    ]);
    const print = jest
      .spyOn(svc, 'print')
      .mockImplementation(() => Promise.resolve(pdf));
    await svc.printAllForOrder('o1', 't1', 'A');
    expect(print).toHaveBeenCalledTimes(3);
    const caches = print.mock.calls.map((c) => c[7]);
    expect(caches[0]).toBeInstanceOf(Map);
    expect(caches[1]).toBe(caches[0]);
    expect(caches[2]).toBe(caches[0]);
    expect(print.mock.calls.map((c) => c[2])).toEqual(['A', 'B', 'B']);
  });

  it('two Print All runs never share a cache, so a changed switch shows up on the next print', async () => {
    const pdf = await onePagePdf();
    const svc = printAllService([{ id: 'r1', branchId: 'A' }]);
    const print = jest
      .spyOn(svc, 'print')
      .mockImplementation(() => Promise.resolve(pdf));
    await svc.printAllForOrder('o1', 't1', 'A');
    await svc.printAllForOrder('o1', 't1', 'A');
    expect(print.mock.calls[0]![7]).not.toBe(print.mock.calls[1]![7]);
  });
});
