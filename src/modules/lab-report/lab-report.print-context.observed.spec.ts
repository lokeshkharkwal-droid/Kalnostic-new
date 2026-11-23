import { LabReportService } from './lab-report.service';

/**
 * The print data of a report (`buildPrintContext`), built for real with only the database stubbed: a Qualitative result
 * written over several lines is delivered to the template with its whitespace exactly as typed, a Quantitative value out of its
 * range keeps its abnormal styling, and the plain readings stay available as `observed1_raw`.
 */
jest.mock('./utils/print-barcode.util', () => ({
  // The real helpers stay (the print code calls several of them); only the two that need a sample/barcode are stubbed.
  ...jest.requireActual<typeof import('./utils/print-barcode.util')>(
    './utils/print-barcode.util',
  ),
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

function build(
  values: Array<Record<string, unknown>>,
  styles: { qual?: string; quant?: string } = {},
) {
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
          abnormalFlagLogic: styles.qual ?? 'BOLD_AND_RED',
        },
        {
          id: QUANT,
          parameterName: 'Glucose',
          groupName: 'Group',
          sortOrder: 2,
          notes: '',
          resultType: 'QUANTITATIVE',
          abnormalFlagLogic: styles.quant ?? 'BOLD_AND_RED',
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
        },
      ]),
    },
  };
  // 13 constructor arguments; the 13th is the ConfigService `buildPrintContext` reads.
  const deps = Array.from({ length: 13 }, (_, i) =>
    i === 12 ? { get: () => undefined } : undefined,
  ) as unknown[];
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
  styles: { qual?: string; quant?: string } = {},
): Promise<Row[]> => {
  const ctx = await build(values, styles).buildPrintContext('r1', T, 'b1');
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

  it('a Qualitative result with Highlight chosen (Bold and Red) is wrapped in that style, but stays non-abnormal', async () => {
    const [row] = await rowsOf([
      value(QUAL, 'Positive', {
        flagOption: 'HIGHLIGHT',
        highlightLogic: 'BOLD_AND_RED',
      }),
    ]);
    // One look for every way a style is applied (the automatic range flag and a Highlight).
    expect(row!.observed1).toBe(
      '<span style="font-weight:bold;color:#d32f2f">Positive</span>',
    );
    // The styling is a presentation choice, not an out-of-range signal.
    expect(row!.is_observed_1_abnormal).toBe(false);
  });

  it('Highlight is applied to BOTH observed values of a parameter', async () => {
    const [row] = await rowsOf([
      value(QUAL, 'Positive', {
        observed2: 'Reactive',
        flagOption: 'HIGHLIGHT',
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

  it('a Qualitative result left on Default is plain, even when its parameter has a style', async () => {
    const [row] = await rowsOf([
      value(QUAL, 'Positive', { flagOption: 'DEFAULT' }),
    ]);
    expect(row!.observed1).toBe('Positive');
  });

  it('an empty reading is never wrapped, even when Highlight is chosen', async () => {
    const [row] = await rowsOf([
      value(QUAL, '', {
        flagOption: 'HIGHLIGHT',
        highlightLogic: 'BOLD_AND_RED',
      }),
    ]);
    expect(row!.observed1).toBe('');
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

describe('Abnormal Flag Logic v1.3 — how one Quantitative reading prints (range 70-110)', () => {
  // The printed value is HTML-escaped ("<5" prints as "&lt;5").
  const esc = (t: string) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const quant = (
    observed1: string,
    over: Record<string, unknown> = {},
    quantStyle = 'BOLD_AND_RED',
  ) =>
    rowsOf([value(QUANT, observed1, { referenceRangeId: RANGE, ...over })], {
      quant: quantStyle,
    }).then((rows) => rows[0]!);

  describe('Default', () => {
    it('a number inside the range is plain', async () => {
      const row = await quant('95.5');
      expect(row.observed1).toBe('95.5');
      expect(row.is_observed_1_abnormal).toBe(false);
    });

    it('a number outside the range prints in the PARAMETER style', async () => {
      expect((await quant('135')).observed1).toBe(
        '<span style="font-weight:bold;color:#d32f2f">135</span>',
      );
      expect((await quant('135', {}, 'ITALIC')).observed1).toBe(
        '<span style="font-style:italic">135</span>',
      );
      expect((await quant('135', {}, 'UNDERLINE')).observed1).toBe(
        '<span style="text-decoration:underline">135</span>',
      );
      expect((await quant('135', {}, 'RED_ONLY')).observed1).toBe(
        '<span style="color:#d32f2f">135</span>',
      );
      expect((await quant('135')).is_observed_1_abnormal).toBe(true);
    });

    it('a "…with High and Low" style adds the word High above the range and Low below it', async () => {
      expect((await quant('185', {}, 'BOLD_AND_RED_HIGH_LOW')).observed1).toBe(
        '<span style="font-weight:bold;color:#d32f2f">185 High</span>',
      );
      expect((await quant('42', {}, 'BOLD_AND_RED_HIGH_LOW')).observed1).toBe(
        '<span style="font-weight:bold;color:#d32f2f">42 Low</span>',
      );
      expect((await quant('185', {}, 'RED_HIGH_LOW')).observed1).toBe(
        '<span style="color:#d32f2f">185 High</span>',
      );
    });

    it('a High Low style prints no word, and no style, for a number inside the range', async () => {
      expect((await quant('95', {}, 'BOLD_AND_RED_HIGH_LOW')).observed1).toBe(
        '95',
      );
    });

    it('the values exactly on the limits are inside the range', async () => {
      expect((await quant('70')).observed1).toBe('70');
      expect((await quant('110')).observed1).toBe('110');
    });

    it.each([
      '<5',
      '>600',
      'Hemolysed',
      '1,200',
      '1e3',
      '0x1F',
      '--67',
      '12 mg/dL',
    ])(
      'a reading that cannot be compared (%s) prints Normal, not abnormal',
      async (text) => {
        const row = await quant(text, {}, 'BOLD_AND_RED_HIGH_LOW');
        expect(row.observed1).toBe(esc(text));
        expect(row.is_observed_1_abnormal).toBe(false);
      },
    );

    it.each(['.5', '-3', '+200', '200.'])(
      'a number written as %s is compared (it is outside 70-110)',
      async (text) => {
        const row = await quant(text);
        expect(row.is_observed_1_abnormal).toBe(true);
      },
    );

    it('a blank reading is Normal', async () => {
      expect((await quant('')).observed1).toBe('');
      expect((await quant('   ')).is_observed_1_abnormal).toBe(false);
    });

    it('a number with no resolved range is Normal (nothing to compare it with)', async () => {
      const [row] = await rowsOf([value(QUANT, '999')]);
      expect(row!.observed1).toBe('999');
      expect(row!.is_observed_1_abnormal).toBe(false);
    });

    it('Observed 2 follows the same rules as Observed 1', async () => {
      const row = await quant(
        '95',
        { observed2: '185' },
        'BOLD_AND_RED_HIGH_LOW',
      );
      expect(row.observed1).toBe('95');
      expect(row.observed2).toBe(
        '<span style="font-weight:bold;color:#d32f2f">185 High</span>',
      );
      expect(row.is_observed_2_abnormal).toBe(true);
      const blank2 = await quant('95', { observed2: '' });
      expect(blank2.observed2).toBe('');
      expect(blank2.is_observed_2_abnormal).toBe(false);
    });
  });

  describe('Not Highlight', () => {
    it('prints Normal even for a number far outside the range', async () => {
      const row = await quant('185', { flagOption: 'NOT_HIGHLIGHT' });
      expect(row.observed1).toBe('185');
      expect(row.is_observed_1_abnormal).toBe(false);
    });

    it('also stays Normal for a Semi-Quantitative / Qualitative reading with a stored style', async () => {
      const [row] = await rowsOf([
        value(QUAL, 'Positive', {
          flagOption: 'NOT_HIGHLIGHT',
          highlightLogic: 'BOLD_AND_RED',
        }),
      ]);
      expect(row!.observed1).toBe('Positive');
    });
  });

  describe('Highlight', () => {
    it('prints the chosen style whatever the value — inside the range, outside it, or not a number', async () => {
      for (const text of ['95', '185', '>600', 'Hemolysed']) {
        const row = await quant(text, {
          flagOption: 'HIGHLIGHT',
          highlightLogic: 'UNDERLINE',
        });
        expect(row.observed1).toBe(
          `<span style="text-decoration:underline">${esc(text)}</span>`,
        );
        expect(row.is_observed_1_abnormal).toBe(false);
      }
    });

    it('never prints a High/Low word, even when the parameter style is a High Low style', async () => {
      const row = await quant(
        '185',
        { flagOption: 'HIGHLIGHT', highlightLogic: 'RED_ONLY' },
        'BOLD_AND_RED_HIGH_LOW',
      );
      expect(row.observed1).toBe('<span style="color:#d32f2f">185</span>');
    });

    it('with no style chosen it starts from the basic style of the parameter style', async () => {
      const row = await quant(
        '95',
        { flagOption: 'HIGHLIGHT', highlightLogic: null },
        'BOLD_ITALIC_AND_RED_HIGH_LOW',
      );
      expect(row.observed1).toBe(
        '<span style="font-weight:bold;font-style:italic;color:#d32f2f">95</span>',
      );
    });

    it('works for a number with no resolved range', async () => {
      const [row] = await rowsOf([
        value(QUANT, '999', {
          flagOption: 'HIGHLIGHT',
          highlightLogic: 'BOLD_ONLY',
        }),
      ]);
      expect(row!.observed1).toBe('<span style="font-weight:bold">999</span>');
    });
  });

  describe('Semi-Quantitative / Qualitative on Default', () => {
    it('always print Normal, whatever the parameter style or the reading', async () => {
      const [row] = await rowsOf(
        [value(QUAL, 'Reactive', { referenceRangeId: RANGE })],
        { qual: 'BOLD_AND_RED' },
      );
      expect(row!.observed1).toBe('Reactive');
      expect(row!.is_observed_1_abnormal).toBe(false);
    });
  });
});
