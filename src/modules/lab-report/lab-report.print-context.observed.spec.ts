import { LabReportService } from './lab-report.service';

/**
 * The print data of a report (`buildPrintContext`), built for real with only the database stubbed: a Qualitative result
 * written over several lines is delivered to the template with its whitespace exactly as typed, a Quantitative value out of its
 * range keeps its abnormal styling, and the plain readings stay available as `observed1_raw`.
 */
jest.mock('./utils/print-barcode.util', () => ({
  buildReportBarcodeTags: jest.fn().mockResolvedValue({
    order_id_barcode: '',
    order_id_qr_code: '',
    sample_id_barcode: '',
  }),
  pickReportSample: jest.fn().mockReturnValue(null),
}));

const T = 't1';
const QUAL = '11111111-1111-4111-8111-111111111111';
const QUANT = '22222222-2222-4222-8222-222222222222';
const RANGE = 'rng-1';

const TYPED = [
  'I am a boy from India.',
  '',
  'I love doing software testing.',
  '    - indented line',
  'two  spaces and a tab\there',
].join('\n');

function build(values: Array<Record<string, unknown>>) {
  const prisma = {
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
    orderDiagnostics: { findUnique: jest.fn().mockResolvedValue(null) },
    labReport: {
      aggregate: jest.fn().mockResolvedValue({ _max: { approvedAt: null } }),
    },
    labReportNote: { findFirst: jest.fn().mockResolvedValue(null) },
    labTestResultParam: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: QUAL,
          parameterName: 'Qualitative Test One',
          groupName: 'Group',
          sortOrder: 1,
          notes: '',
          resultType: 'QUALITATIVE',
        },
        {
          id: QUANT,
          parameterName: 'Glucose',
          groupName: 'Group',
          sortOrder: 2,
          notes: '',
          resultType: 'QUANTITATIVE',
        },
      ]),
    },
    labReportOverallResult: { findMany: jest.fn().mockResolvedValue([]) },
    labTestReferenceRange: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: RANGE,
          lowerLimit: 70,
          upperLimit: 110,
          abnormalFlagLogic: 'BOLD_AND_RED',
        },
      ]),
    },
  };
  const deps = Array(11).fill(undefined) as unknown[];
  deps[0] = prisma;
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  const internals = service as unknown as Record<string, unknown>;
  internals.findById = jest.fn().mockResolvedValue({
    id: 'r1',
    orderItemId: 'oi1',
    labTestId: 'lt1',
    status: 'SAVED',
    memberBranchLabTestId: null,
    attachments: [],
    parameterNotes: [],
    contentSections: {},
    resultValues: values,
    orderItem: {
      direct: null,
      branchLabTest: { testName: 'Qualitative Test Print' },
      branchLabPanel: null,
      order: {
        id: 'o1',
        orderCode: 'ORD-00487',
        orderDate: new Date('2026-10-14T00:00:00Z'),
        createdAt: new Date('2026-10-14T15:36:00Z'),
        orderTime: null,
        externalOrderId: null,
        referredByDoctor: null,
        referralPanel: null,
        patient: {
          firstName: 'Anand',
          middleName: null,
          lastName: 'Pandit',
          salutation: 'MR',
          gender: 'MALE',
          age: 31,
          ageType: 'YEARS',
          dateOfBirth: null,
          umId: 'PAT2026/0003',
          mobile: '+91-8436348436',
          addressLine1: null,
          photoUrl: null,
        },
      },
    },
  });
  internals.resolveStoredSignatories = jest.fn().mockResolvedValue([]);
  internals.resolveApprovingDoctor = jest.fn().mockResolvedValue(null);
  internals.siblingReportIds = jest.fn().mockResolvedValue(['r1']);
  internals.requireBranch = jest.fn().mockReturnValue('b1');
  (service as unknown as { tenantService: unknown }).tenantService = {
    getLocale: jest.fn().mockResolvedValue({
      timezone: 'Asia/Kolkata',
      dateFormat: 'DD-MM-YYYY',
      timeFormat: 'hh:mm A',
    }),
  };
  return service;
}

const value = (
  resultParamId: string,
  observed1: string,
  over: Record<string, unknown> = {},
) => ({
  resultParamId,
  observed1,
  observed2: null,
  unit: null,
  methodology: null,
  referenceRangeId: null,
  referenceDisplay: null,
  ...over,
});

type Row = Record<string, unknown>;
const rowsOf = async (
  values: Array<Record<string, unknown>>,
): Promise<Row[]> => {
  const ctx = await build(values).buildPrintContext('r1', T, 'b1');
  return (ctx.sections as { results: Row[] }).results;
};

describe('buildPrintContext — the result readings a template receives', () => {
  it('a multi-line Qualitative result: whitespace kept exactly as typed, as a left-aligned pre-wrap block', async () => {
    const [row] = await rowsOf([value(QUAL, TYPED)]);
    expect(row!.observed1).toBe(
      `<span style="display:block;white-space:pre-wrap;text-align:left">${TYPED}</span>`,
    );
    expect(String(row!.observed1)).toContain(
      'I am a boy from India.\n\nI love doing software testing.\n    - indented line',
    );
  });

  it('the plain reading is still there, untouched, for plain-text consumers', async () => {
    const [row] = await rowsOf([value(QUAL, TYPED)]);
    expect(row!.observed1_raw).toBe(TYPED);
  });

  it('typed markup is escaped inside the block', async () => {
    const [row] = await rowsOf([value(QUAL, '<b>bold</b>\nsecond & third')]);
    expect(String(row!.observed1)).toContain(
      '&lt;b&gt;bold&lt;/b&gt;\nsecond &amp; third',
    );
    expect(String(row!.observed1)).not.toContain('<b>');
  });

  it('an ordinary one-line Qualitative result is only escaped, exactly as before', async () => {
    const [row] = await rowsOf([value(QUAL, 'Positive')]);
    expect(row!.observed1).toBe('Positive');
    expect(row!.is_observed_1_abnormal).toBe(false);
  });

  it('a Quantitative value out of its range keeps its abnormal styling', async () => {
    const [row] = await rowsOf([
      value(QUANT, '180', { referenceRangeId: RANGE }),
    ]);
    expect(row!.observed1).toBe(
      '<span style="font-weight:bold;color:#d32f2f">180</span>',
    );
    expect(row!.is_observed_1_abnormal).toBe(true);
  });

  it('a Quantitative value inside its range is plain', async () => {
    const [row] = await rowsOf([
      value(QUANT, '90', { referenceRangeId: RANGE }),
    ]);
    expect(row!.observed1).toBe('90');
    expect(row!.is_observed_1_abnormal).toBe(false);
  });

  it('a Qualitative multi-line result is never given the abnormal styling, even with a range attached', async () => {
    const [row] = await rowsOf([
      value(QUAL, TYPED, { referenceRangeId: RANGE }),
    ]);
    expect(row!.is_observed_1_abnormal).toBe(false);
    expect(String(row!.observed1)).not.toContain('color:#d32f2f');
  });

  it('a Qualitative result flagged "Highlight in Report" (Bold and Red) is wrapped in bold-red, but stays non-abnormal', async () => {
    const [row] = await rowsOf([
      value(QUAL, 'Positive', {
        highlightInReport: true,
        highlightLogic: 'BOLD_AND_RED',
      }),
    ]);
    expect(row!.observed1).toBe(
      '<span style="font-weight:bold;color:#d32f2f">Positive</span>',
    );
    // The styling is a presentation choice, not an out-of-range signal.
    expect(row!.is_observed_1_abnormal).toBe(false);
  });

  it('highlighting is applied to BOTH observed values of a highlighted parameter', async () => {
    const [row] = await rowsOf([
      value(QUAL, 'Positive', {
        observed2: 'Reactive',
        highlightInReport: true,
        highlightLogic: 'BOLD_AND_RED',
      }),
    ]);
    expect(row!.observed1).toBe(
      '<span style="font-weight:bold;color:#d32f2f">Positive</span>',
    );
    expect(row!.observed2).toBe(
      '<span style="font-weight:bold;color:#d32f2f">Reactive</span>',
    );
  });

  it('a Qualitative result NOT flagged for highlight is left plain', async () => {
    const [row] = await rowsOf([
      value(QUAL, 'Positive', { highlightInReport: false }),
    ]);
    expect(row!.observed1).toBe('Positive');
  });

  it('an empty reading is never wrapped, even when highlight is on', async () => {
    const [row] = await rowsOf([
      value(QUAL, '', {
        highlightInReport: true,
        highlightLogic: 'BOLD_AND_RED',
      }),
    ]);
    expect(row!.observed1).toBe('');
  });

  it('a Quantitative value is never highlighted by the manual control (scope restriction) — only auto-flagged out of range', async () => {
    const [row] = await rowsOf([
      value(QUANT, '90', {
        referenceRangeId: RANGE,
        highlightInReport: true,
        highlightLogic: 'BOLD_AND_RED',
      }),
    ]);
    expect(row!.observed1).toBe('90');
    expect(row!.is_observed_1_abnormal).toBe(false);
  });

  it('both kinds in one report come out in parameter order, each as it should', async () => {
    const rows = await rowsOf([
      value(QUANT, '180', { referenceRangeId: RANGE }),
      value(QUAL, TYPED),
    ]);
    expect(rows.map((r) => r.parameter_name)).toEqual([
      'Qualitative Test One',
      'Glucose',
    ]);
    expect(String(rows[0]!.observed1)).toContain('white-space:pre-wrap');
    expect(rows[1]!.observed1).toContain('color:#d32f2f');
  });

  it('the second reading (observed2) keeps its whitespace the same way', async () => {
    const [row] = await rowsOf([value(QUAL, 'x', { observed2: 'a\nb' })]);
    expect(row!.observed2).toBe(
      '<span style="display:block;white-space:pre-wrap;text-align:left">a\nb</span>',
    );
    expect(row!.observed2_raw).toBe('a\nb');
  });
});
