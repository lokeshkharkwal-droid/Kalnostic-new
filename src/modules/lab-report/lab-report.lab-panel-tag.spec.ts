import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { labPanelTags } from './utils/lab-panel-tag.util';

/**
 * The "does this test belong to a lab panel" print tags: `is_lab_panel` ("Yes" or
 * empty), `lab_panel_name`, `lab_panel_code`. They come from the report's ORDER LINE
 * (`orderItem.branchLabPanelId` + its panel), so a panel's member reports and an old
 * combined panel report carry them; a single test and a free-text line do not.
 */
jest.setTimeout(30_000);

type Kind = 'TEST' | 'PANEL' | 'DIRECT';

function report(kind: Kind, member: string | null = 'm1') {
  return {
    id: 'r1',
    status: LabReportStatus.APPROVED,
    branchId: 'A',
    orderItemId: 'item1',
    memberBranchLabTestId: kind === 'PANEL' ? member : null,
    excludedNoteSections: [],
    orderItem: {
      direct: kind === 'DIRECT' ? 'Free text' : null,
      branchLabPanelId: kind === 'PANEL' ? 'panel1' : null,
      branchLabTestId: kind === 'TEST' ? 'test1' : null,
      branchLabTest: kind === 'TEST' ? { testName: 'TSH' } : null,
      branchLabPanel:
        kind === 'PANEL'
          ? { panelName: 'Thyroid Profile', panelCode: 'THY-01' }
          : null,
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
      usefulFor: null,
      interpretation: null,
      limitations: null,
      remarks: null,
      references: null,
    },
    attachments: [],
    resultValues: [],
  };
}

function makeService(rep: ReturnType<typeof report>): LabReportService {
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    loadReportDetail: jest.fn().mockResolvedValue(rep),
    findById: jest.fn().mockResolvedValue(rep),
    resolveStoredSignatories: jest.fn().mockResolvedValue([]),
    resolveApprovingDoctor: jest.fn().mockResolvedValue(null),
    siblingReportIds: jest.fn().mockResolvedValue(['r1']),
    requireBranch: (b: string) => b,
    technicianSettingsService: {
      getNotesPrintSwitches: jest
        .fn()
        .mockResolvedValue({ labTest: true, labPanel: true }),
    },
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

const variablesOf = async (rep: ReturnType<typeof report>) => {
  const ctx = await makeService(rep).buildPrintContext('r1', 't1', 'A', false);
  return (ctx as unknown as { variables: Record<string, string> }).variables;
};

describe('labPanelTags', () => {
  it('an order line ordered as a panel gives Yes plus the panel name and code', () => {
    expect(
      labPanelTags({
        branchLabPanelId: 'p',
        branchLabPanel: { panelName: 'CBC Profile', panelCode: 'CBC' },
      }),
    ).toEqual({
      is_lab_panel: 'Yes',
      lab_panel_name: 'CBC Profile',
      lab_panel_code: 'CBC',
    });
  });

  it('everything is empty (never "No") when the line is not a panel', () => {
    expect(labPanelTags({ branchLabPanelId: null })).toEqual({
      is_lab_panel: '',
      lab_panel_name: '',
      lab_panel_code: '',
    });
  });

  it('still says Yes when the panel row is not loaded, with an empty name and code', () => {
    expect(
      labPanelTags({ branchLabPanelId: 'p', branchLabPanel: null }),
    ).toEqual({ is_lab_panel: 'Yes', lab_panel_name: '', lab_panel_code: '' });
  });
});

describe('print context: lab panel tags', () => {
  it('a member report of a panel carries Yes, the panel name and the panel code', async () => {
    const v = await variablesOf(report('PANEL', 'm1'));
    expect(v.is_lab_panel).toBe('Yes');
    expect(v.lab_panel_name).toBe('Thyroid Profile');
    expect(v.lab_panel_code).toBe('THY-01');
  });

  it('an old combined panel report (no member test) is a panel report too', async () => {
    const v = await variablesOf(report('PANEL', null));
    expect(v.is_lab_panel).toBe('Yes');
    expect(v.lab_panel_name).toBe('Thyroid Profile');
    expect(v.lab_panel_code).toBe('THY-01');
  });

  it('a single test carries empty tags', async () => {
    const v = await variablesOf(report('TEST'));
    expect(v.is_lab_panel).toBe('');
    expect(v.lab_panel_name).toBe('');
    expect(v.lab_panel_code).toBe('');
  });

  it('a free-text line carries empty tags', async () => {
    const v = await variablesOf(report('DIRECT'));
    expect(v.is_lab_panel).toBe('');
    expect(v.lab_panel_code).toBe('');
  });

  it('a panel member keeps its own printed fields (the tags add, they do not replace)', async () => {
    const v = await variablesOf(report('PANEL', 'm1'));
    expect(v.order_code).toBe('ORD-1');
    expect(v.patient_name).toBe('Rahul Kumar');
  });
});

describe('Latte single-test context: lab panel tags', () => {
  const latteTest = (variables: Record<string, string>) => {
    const svc = makeService(report('TEST')) as unknown as {
      buildTestLatteContext: (ctx: unknown) => {
        tests: Array<Record<string, unknown>>;
      };
    };
    return svc.buildTestLatteContext({ variables, sections: { results: [] } })
      .tests[0]!;
  };

  it('is_lab_panel is a real boolean, so {if $test->is_lab_panel} branches', () => {
    expect(
      latteTest({
        is_lab_panel: 'Yes',
        lab_panel_name: 'Thyroid Profile',
        lab_panel_code: 'THY-01',
      }),
    ).toMatchObject({
      is_lab_panel: true,
      lab_panel_name: 'Thyroid Profile',
      lab_panel_code: 'THY-01',
    });
    expect(latteTest({ is_lab_panel: '' })).toMatchObject({
      is_lab_panel: false,
      lab_panel_name: '',
      lab_panel_code: '',
    });
  });
});
