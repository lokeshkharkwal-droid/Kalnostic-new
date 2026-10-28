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

  it('while the Lab Test switch is off, every section prints whatever was saved', async () => {
    const svc = makeService(
      report({ excluded: ['limitations', 'remarks'] }),
      jest.fn().mockResolvedValue({ labTest: false, labPanel: true }),
    );
    const { variables } = await printed(svc);
    for (const k of SECTION_KEYS) expect(variables[k]).not.toBe('');
  });

  it('a report on a panel order line follows the Lab Panel switch, not the Lab Test one', async () => {
    const left = ['interpretation'];
    const panelOn = makeService(
      report({ kind: 'PANEL', excluded: left }),
      jest.fn().mockResolvedValue({ labTest: false, labPanel: true }),
    );
    expect((await printed(panelOn)).variables.interpretation).toBe('');

    const panelOff = makeService(
      report({ kind: 'PANEL', excluded: left }),
      jest.fn().mockResolvedValue({ labTest: true, labPanel: false }),
    );
    expect((await printed(panelOff)).variables.interpretation).toBe('I-text');
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
  function updating(switches: NotesPrintSwitches, kind: 'TEST' | 'PANEL') {
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
      }),
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
      data: { excludedNoteSections: ['useful_for', 'references'] },
    });
    expect(result).toEqual({
      enabled: true,
      isPanelMember: false,
      excludedSections: ['useful_for', 'references'],
    });
  });

  it('an empty list clears the choice (all sections print again)', async () => {
    const { svc, update } = updating(ALL_ON, 'PANEL');
    const result = await svc.updateNotePrintSections('r1', 't1', 'A', {
      excludedSections: [],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { excludedNoteSections: [] },
    });
    expect(result).toMatchObject({ enabled: true, isPanelMember: true });
  });

  it('while the matching switch is off nothing is saved and the state comes back unchanged', async () => {
    const { svc, update } = updating(
      { labTest: false, labPanel: true },
      'TEST',
    );
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
