import { AbnormalFlag, LabReportStatus, ResultType } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { buildResultPrintSnapshot } from './utils/print-snapshot.util';
import { abnormalFlagStyle } from './utils/reference-range.util';

/**
 * "Old reports must not change": once a report is finished its print comes from the decision frozen at
 * validate, not from today's Master Data. These tests drive `buildPrintContext` with a parameter that
 * has been edited since (renamed, regrouped, re-ordered, restyled, re-noted) and check the finished
 * report still prints as it was, while an unfinished or unfrozen report follows the live rules.
 */
jest.setTimeout(30_000);

type Row = Record<string, string | boolean>;

/** The parameter as it is NOW in Master Data (edited after the report was finished). */
const liveParam = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  parameterName: 'Glucose (renamed)',
  groupName: 'New group',
  sortOrder: 9,
  notes: 'new configured note',
  resultType: ResultType.QUANTITATIVE,
  abnormalFlagLogic: AbnormalFlag.UNDERLINE as AbnormalFlag | null,
  ...over,
});

/** The parameter as it was when the report was validated. */
const thenParam = {
  parameterName: 'Glucose',
  groupName: 'Old group',
  sortOrder: 1,
  resultType: ResultType.QUANTITATIVE,
  abnormalFlagLogic: AbnormalFlag.ITALIC as AbnormalFlag | null,
  notes: 'old configured note',
};

const RANGE = { lowerLimit: 70, upperLimit: 110 };

function value(over: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    resultParamId: 'p1',
    observed1: '150',
    observed2: null,
    unit: 'mg/dL',
    methodology: null,
    referenceRangeId: 'rr1',
    referenceDisplay: '70-110',
    flagOption: 'DEFAULT',
    highlightLogic: null,
    printSnapshot: null as unknown,
    ...over,
  };
}

const frozenAsThen = () =>
  buildResultPrintSnapshot(
    thenParam,
    {
      observed1: '150',
      observed2: null,
      flagOption: 'DEFAULT',
      highlightLogic: null,
    },
    RANGE,
  );

function service(
  status: LabReportStatus,
  values: ReturnType<typeof value>[],
  live: ReturnType<typeof liveParam>[],
  parameterNotes: Array<{ resultParamId: string; content: string }> = [],
) {
  const rep = {
    id: 'r1',
    status,
    branchId: 'A',
    orderItemId: 'item1',
    memberBranchLabTestId: null,
    excludedNoteSections: [],
    orderItem: {
      direct: null,
      branchLabPanelId: null,
      branchLabTestId: 'test1',
      branchLabTest: { testName: 'Glucose test' },
      branchLabPanel: null,
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
    parameterNotes,
    contentSections: {
      usefulFor: null,
      interpretation: null,
      limitations: null,
      remarks: null,
      references: null,
    },
    attachments: [],
    resultValues: values,
  };
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    config: { get: jest.fn() },
    logger: { warn: jest.fn(), log: jest.fn() },
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
      labTestResultParam: { findMany: jest.fn().mockResolvedValue(live) },
      labTestReferenceRange: {
        findMany: jest.fn().mockResolvedValue([{ id: 'rr1', ...RANGE }]),
      },
      labReportOverallResult: { findMany: jest.fn().mockResolvedValue([]) },
    },
  });
  return svc;
}

async function rowsOf(svc: LabReportService): Promise<Row[]> {
  const ctx = (await svc.buildPrintContext(
    'r1',
    't1',
    'A',
    false,
  )) as unknown as {
    sections: { results: Row[] };
  };
  return ctx.sections.results;
}

const warnings = (svc: LabReportService) =>
  (svc as unknown as { logger: { warn: jest.Mock } }).logger.warn;

const ITALIC_SPAN = `<span style="${abnormalFlagStyle(AbnormalFlag.ITALIC)}">150</span>`;
const UNDERLINE_SPAN = `<span style="${abnormalFlagStyle(AbnormalFlag.UNDERLINE)}">150</span>`;

describe('a finished report prints from its frozen decision', () => {
  it.each([
    LabReportStatus.RESULT_DONE,
    LabReportStatus.APPROVED,
    LabReportStatus.PUBLISHED,
  ])(
    '%s: the style, name, group, order and configured note are the ones frozen, not the edited Master Data',
    async (status) => {
      const svc = service(
        status,
        [value({ printSnapshot: frozenAsThen() })],
        [liveParam()],
      );
      const [row] = await rowsOf(svc);
      expect(row).toMatchObject({
        parameter_name: 'Glucose',
        group_name: 'Old group',
        observed1: ITALIC_SPAN,
        is_observed_1_abnormal: true,
        result_note: 'old configured note',
      });
      expect(warnings(svc)).not.toHaveBeenCalled();
    },
  );

  it('the frozen order decides the row order, not the live sort order', async () => {
    const snapA = { ...frozenAsThen(), name: 'First', order: 1 };
    const snapB = { ...frozenAsThen(), name: 'Second', order: 2 };
    const svc = service(
      LabReportStatus.APPROVED,
      [
        value({ id: 'v2', resultParamId: 'p2', printSnapshot: snapB }),
        value({ id: 'v1', resultParamId: 'p1', printSnapshot: snapA }),
      ],
      // today's order is the opposite
      [
        liveParam({ id: 'p1', sortOrder: 20 }),
        liveParam({ id: 'p2', sortOrder: 5 }),
      ],
    );
    const rows = await rowsOf(svc);
    expect(rows.map((r) => r.parameter_name)).toEqual(['First', 'Second']);
  });

  it('a style removed from the parameter later does not un-style a frozen out-of-range value', async () => {
    const svc = service(
      LabReportStatus.APPROVED,
      [value({ printSnapshot: frozenAsThen() })],
      [liveParam({ abnormalFlagLogic: null })],
    );
    expect((await rowsOf(svc))[0]).toMatchObject({ observed1: ITALIC_SPAN });
  });

  it('a value that printed Normal stays Normal when the parameter later gets a style', async () => {
    const normalThen = buildResultPrintSnapshot(
      { ...thenParam, abnormalFlagLogic: null },
      {
        observed1: '150',
        observed2: null,
        flagOption: 'DEFAULT',
        highlightLogic: null,
      },
      RANGE,
    );
    const svc = service(
      LabReportStatus.APPROVED,
      [value({ printSnapshot: normalThen })],
      [liveParam({ abnormalFlagLogic: AbnormalFlag.BOLD_AND_RED })],
    );
    expect((await rowsOf(svc))[0]).toMatchObject({
      observed1: '150',
      is_observed_1_abnormal: false,
    });
  });

  it("the technician's own note for the report is still live; only the configured note is frozen", async () => {
    const svc = service(
      LabReportStatus.APPROVED,
      [value({ printSnapshot: frozenAsThen() })],
      [liveParam()],
      [{ resultParamId: 'p1', content: '<p>my note</p>' }],
    );
    expect((await rowsOf(svc))[0]).toMatchObject({
      result_note: '<p>my note</p>',
    });
  });

  it('Observed 1 and Observed 2 keep their own marks', async () => {
    const snap = buildResultPrintSnapshot(
      thenParam,
      {
        observed1: '150',
        observed2: '90',
        flagOption: 'DEFAULT',
        highlightLogic: null,
      },
      RANGE,
    );
    const svc = service(
      LabReportStatus.APPROVED,
      [value({ observed2: '90', printSnapshot: snap })],
      [liveParam()],
    );
    expect((await rowsOf(svc))[0]).toMatchObject({
      observed1: ITALIC_SPAN,
      observed2: '90',
      is_observed_1_abnormal: true,
      is_observed_2_abnormal: false,
    });
  });
});

describe('a report without a usable frozen decision follows the live rules, and says so', () => {
  it('a finished report never frozen (old data, backfill not run) prints from the live parameter and logs a warning', async () => {
    const svc = service(
      LabReportStatus.APPROVED,
      [value({ printSnapshot: null })],
      [liveParam()],
    );
    expect((await rowsOf(svc))[0]).toMatchObject({
      parameter_name: 'Glucose (renamed)',
      observed1: UNDERLINE_SPAN,
    });
    expect(warnings(svc)).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an unknown version', { v: 99 }],
    [
      'a broken mark',
      { v: 1, o1: { style: 'NOPE', label: null, abnormal: true } },
    ],
    ['a string', 'garbage'],
    ['an array', []],
  ])('%s is refused, never half-trusted', async (_name, bad) => {
    const svc = service(
      LabReportStatus.APPROVED,
      [value({ printSnapshot: bad })],
      [liveParam()],
    );
    expect((await rowsOf(svc))[0]).toMatchObject({ observed1: UNDERLINE_SPAN });
    expect(warnings(svc)).toHaveBeenCalled();
  });

  it('an unfinished report ignores any leftover snapshot (it is being edited)', async () => {
    const svc = service(
      LabReportStatus.SAVED,
      [value({ printSnapshot: frozenAsThen() })],
      [liveParam()],
    );
    const ctx = (await svc.buildPrintContext('r1', 't1', 'A', false, {
      maskUnfinished: false,
    })) as unknown as { sections: { results: Row[] } };
    expect(ctx.sections.results[0]).toMatchObject({
      parameter_name: 'Glucose (renamed)',
      observed1: UNDERLINE_SPAN,
    });
  });
});
