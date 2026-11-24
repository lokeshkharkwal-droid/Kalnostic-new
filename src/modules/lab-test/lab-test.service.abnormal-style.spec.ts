import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AbnormalFlag, ResultType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from './lab-test.service';
import {
  ImportXlsxResultParamRowDto,
  OPTIONAL_XLSX_COLUMNS,
  REFERENCE_RANGE_LABEL_COL,
  REFERENCE_VALUE_LABEL_COL,
  XLSX_COLUMNS,
} from './dto/import-lab-tests-xlsx.dto';

/**
 * Abnormal Flag Logic v1.3 on the Master Data side: the style belongs to the result parameter (not to its
 * reference ranges / values), a "…with High and Low" style is Quantitative-only, a result-type change can never
 * leave one behind, and the Excel import reads the style from a parameter-level column.
 */
type Fields = Record<string, unknown>;
type Where = { where: Fields; data: Fields };

function build(existing: Array<Fields> = []) {
  const labTestResultParam = {
    findMany: jest.fn().mockResolvedValue(existing),
    update: jest.fn<Promise<unknown>, [Where]>().mockResolvedValue({}),
    create: jest
      .fn<Promise<unknown>, [{ data: Fields }]>()
      .mockResolvedValue({ id: 'p-new' }),
    updateMany: jest.fn().mockResolvedValue({}),
  };
  const tx = {
    labTestResultParam,
    labTestReferenceRange: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({}),
    },
    labTestReferenceValue: {
      updateMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({}),
    },
  };
  const service = new LabTestService(
    {} as unknown as PrismaService,
    {} as unknown as MasterDataService,
  );
  const priv = service as unknown as {
    upsertParamsByCode: (...a: unknown[]) => Promise<void>;
    assertParam: (p: Fields) => void;
    assertImportParam: (p: Fields) => void;
    coerceCellValue: (field: string, text: string) => unknown;
    flattenValidationMessages: (
      e: unknown,
      rowLabel: string,
    ) => { rowLabel: string; column: string; message: string }[];
  };
  const save = (params: unknown[]) =>
    priv.upsertParamsByCode(
      tx,
      't1',
      'b1',
      'lt1',
      params,
      new Date('2026-11-19'),
    );
  return { save, priv, tx, labTestResultParam };
}

const param = (over: Fields = {}) => ({
  id: 'p1',
  parameterName: 'Glucose',
  parameterCode: 'GLU',
  resultType: ResultType.QUANTITATIVE,
  ...over,
});
const patched = (m: ReturnType<typeof build>) =>
  m.labTestResultParam.update.mock.calls[0]![0].data;

describe('a "…with High and Low" style is Quantitative-only (Master Data save)', () => {
  it('is accepted on a Quantitative parameter', () => {
    const m = build();
    expect(() =>
      m.priv.assertParam(
        param({ abnormalFlagLogic: AbnormalFlag.BOLD_AND_RED_HIGH_LOW }),
      ),
    ).not.toThrow();
  });

  it.each([ResultType.QUALITATIVE, ResultType.SEMI_QUANTITATIVE])(
    'is refused on a %s parameter, with a message that names the style',
    (resultType) => {
      const m = build();
      let caught: unknown;
      try {
        m.priv.assertParam(
          param({
            resultType,
            abnormalFlagLogic: AbnormalFlag.RED_HIGH_LOW,
          }),
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ValidationException);
      // The readable text is in the response body (`error.message`), not in `.message`.
      const body = (caught as ValidationException).getResponse() as {
        error: { message: string };
      };
      expect(body.error.message).toMatch(
        /Red with High and Low.*only available for Quantitative/,
      );
    },
  );

  it.each([ResultType.QUALITATIVE, ResultType.SEMI_QUANTITATIVE])(
    'every one of the nine basic styles is fine on a %s parameter',
    (resultType) => {
      const m = build();
      for (const style of [
        AbnormalFlag.RED_ONLY,
        AbnormalFlag.BOLD_ONLY,
        AbnormalFlag.ITALIC,
        AbnormalFlag.BOLD_AND_ITALIC,
        AbnormalFlag.BOLD_AND_RED,
        AbnormalFlag.ITALIC_AND_RED,
        AbnormalFlag.BOLD_ITALIC_AND_RED,
        AbnormalFlag.UNDERLINE,
        AbnormalFlag.COLOUR_HIGHLIGHT,
      ]) {
        expect(() =>
          m.priv.assertParam(param({ resultType, abnormalFlagLogic: style })),
        ).not.toThrow();
      }
    },
  );

  it('a parameter that sends no style is accepted (it keeps its style / starts blank)', () => {
    const m = build();
    expect(() =>
      m.priv.assertParam(param({ resultType: ResultType.QUALITATIVE })),
    ).not.toThrow();
  });

  it('the Excel import applies the same rule', () => {
    const m = build();
    expect(() =>
      m.priv.assertImportParam(
        param({
          resultType: ResultType.QUALITATIVE,
          abnormalFlagLogic: AbnormalFlag.BOLD_HIGH_LOW,
        }),
      ),
    ).toThrow(ValidationException);
    expect(() =>
      m.priv.assertImportParam(
        param({ abnormalFlagLogic: AbnormalFlag.BOLD_HIGH_LOW }),
      ),
    ).not.toThrow();
  });
});

describe('changing a parameter away from Quantitative never leaves a High Low style behind', () => {
  const stored = (style: AbnormalFlag) => [
    { id: 'p1', parameterCode: 'GLU', abnormalFlagLogic: style },
  ];

  it('a save that changes the result type and sends no style turns the stored High Low style into its basic style', async () => {
    const m = build(stored(AbnormalFlag.BOLD_AND_RED_HIGH_LOW));
    await m.save([param({ resultType: ResultType.QUALITATIVE })]);
    expect(patched(m)).toHaveProperty(
      'abnormalFlagLogic',
      AbnormalFlag.BOLD_AND_RED,
    );
  });

  it('it also covers Semi-Quantitative, for any High Low style', async () => {
    const m = build(stored(AbnormalFlag.RED_HIGH_LOW));
    await m.save([param({ resultType: ResultType.SEMI_QUANTITATIVE })]);
    expect(patched(m)).toHaveProperty(
      'abnormalFlagLogic',
      AbnormalFlag.RED_ONLY,
    );
  });

  it('a parameter that stays Quantitative keeps its High Low style (the save does not write the style)', async () => {
    const m = build(stored(AbnormalFlag.RED_HIGH_LOW));
    await m.save([param()]);
    expect(patched(m)).not.toHaveProperty('abnormalFlagLogic');
  });

  it('a basic style is left alone when the type changes', async () => {
    const m = build(stored(AbnormalFlag.UNDERLINE));
    await m.save([param({ resultType: ResultType.QUALITATIVE })]);
    expect(patched(m)).not.toHaveProperty('abnormalFlagLogic');
  });

  it('a style the client does send is written as sent', async () => {
    const m = build(stored(AbnormalFlag.BOLD_ONLY));
    await m.save([
      param({
        resultType: ResultType.QUALITATIVE,
        abnormalFlagLogic: AbnormalFlag.ITALIC,
      }),
    ]);
    expect(patched(m)).toHaveProperty('abnormalFlagLogic', AbnormalFlag.ITALIC);
  });
});

describe('the parameter style is optional (blank = no style)', () => {
  const stored = (style: AbnormalFlag | null) => [
    { id: 'p1', parameterCode: 'GLU', abnormalFlagLogic: style },
  ];

  it.each(Object.values(ResultType))(
    'an explicit blank (null) style is accepted on a %s parameter',
    (resultType) => {
      const m = build();
      expect(() =>
        m.priv.assertParam(param({ resultType, abnormalFlagLogic: null })),
      ).not.toThrow();
      expect(() =>
        m.priv.assertImportParam(
          param({ resultType, abnormalFlagLogic: null }),
        ),
      ).not.toThrow();
    },
  );

  it('an update that sends null clears the stored style', async () => {
    const m = build(stored(AbnormalFlag.ITALIC));
    await m.save([param({ abnormalFlagLogic: null })]);
    expect(patched(m)).toHaveProperty('abnormalFlagLogic', null);
  });

  it('an update that sends nothing keeps a blank style blank (no write)', async () => {
    const m = build(stored(null));
    await m.save([param()]);
    expect(patched(m)).not.toHaveProperty('abnormalFlagLogic');
  });

  it('a NEW parameter saved without a style is created without one (blank, no default)', async () => {
    const m = build([]);
    await m.save([param({ id: undefined, parameterCode: 'NEWP' })]);
    expect(m.labTestResultParam.create).toHaveBeenCalled();
    const data = m.labTestResultParam.create.mock.calls[0]![0].data;
    expect(data.abnormalFlagLogic ?? null).toBeNull();
  });

  it('a blank style stays blank when the result type changes (it is never turned into Bold and Red)', async () => {
    const m = build(stored(null));
    await m.save([param({ resultType: ResultType.QUALITATIVE })]);
    expect(patched(m)).not.toHaveProperty('abnormalFlagLogic');
  });
});

describe('Excel import: the style is a parameter-level column', () => {
  it('the column list has one "abnormal flag logic" (parameter) and no range / value copies', () => {
    expect(
      XLSX_COLUMNS.filter((c) => c === 'abnormal flag logic'),
    ).toHaveLength(1);
    expect(
      (XLSX_COLUMNS as readonly string[]).filter(
        (c) => c === 'ABNORMAL FLAG LOGIC',
      ),
    ).toHaveLength(0);
  });

  it('it sits in the Result Parameters block, right after "result rounding type"', () => {
    const i = XLSX_COLUMNS.indexOf('abnormal flag logic');
    expect(XLSX_COLUMNS[i - 1]).toBe('result rounding type');
    expect(i).toBeLessThan(XLSX_COLUMNS.indexOf('REFERENCE RANGE'));
  });

  it('the section-label column positions follow the list (they are derived, not hard-coded)', () => {
    expect(XLSX_COLUMNS[REFERENCE_RANGE_LABEL_COL]).toBe('REFERENCE RANGE');
    expect(XLSX_COLUMNS[REFERENCE_VALUE_LABEL_COL]).toBe('REFERENCE VALUE');
  });

  it('the column is optional, so a file exported before the change still imports', () => {
    expect(OPTIONAL_XLSX_COLUMNS).toEqual(['abnormal flag logic']);
    for (const c of OPTIONAL_XLSX_COLUMNS) expect(XLSX_COLUMNS).toContain(c);
  });

  it('every one of the 16 styles can be written by label, in any letter case, or by its name', () => {
    const m = build();
    expect(m.priv.coerceCellValue('abnormalFlagLogic', 'Red')).toBe('RED_ONLY');
    expect(m.priv.coerceCellValue('abnormalFlagLogic', 'bold italic')).toBe(
      'BOLD_AND_ITALIC',
    );
    expect(m.priv.coerceCellValue('abnormalFlagLogic', 'Underline')).toBe(
      'UNDERLINE',
    );
    expect(
      m.priv.coerceCellValue('abnormalFlagLogic', 'Colour Highlight'),
    ).toBe('COLOUR_HIGHLIGHT');
    expect(
      m.priv.coerceCellValue(
        'abnormalFlagLogic',
        'Bold and Red with High and Low',
      ),
    ).toBe('BOLD_AND_RED_HIGH_LOW');
    expect(
      m.priv.coerceCellValue(
        'abnormalFlagLogic',
        'BOLD_ITALIC_AND_RED_HIGH_LOW',
      ),
    ).toBe('BOLD_ITALIC_AND_RED_HIGH_LOW');
  });

  it('the old label "Italic Bold" and the old export spelling "Bold And Red" still import', () => {
    const m = build();
    expect(m.priv.coerceCellValue('abnormalFlagLogic', 'Italic Bold')).toBe(
      'BOLD_AND_ITALIC',
    );
    expect(m.priv.coerceCellValue('abnormalFlagLogic', 'Bold And Red')).toBe(
      'BOLD_AND_RED',
    );
  });

  it('a blank cell means "no style sent"; an unknown word is passed through to be rejected by validation', () => {
    const m = build();
    expect(m.priv.coerceCellValue('abnormalFlagLogic', '')).toBeUndefined();
    expect(m.priv.coerceCellValue('abnormalFlagLogic', 'Sparkly')).toBe(
      'Sparkly',
    );
  });
});

describe('Excel import: a style the system does not have is refused, with a message that helps', () => {
  /** What the import summary shows for one parameter row whose "abnormal flag logic" cell holds `typed`. */
  const messagesFor = async (typed: string, resultType = 'QUANTITATIVE') => {
    const m = build();
    const row = plainToInstance(ImportXlsxResultParamRowDto, {
      parameterName: 'Glucose',
      parameterCode: 'GLU',
      resultType,
      abnormalFlagLogic: m.priv.coerceCellValue('abnormalFlagLogic', typed),
    });
    const failures = await validate(row, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return failures
      .filter((f) => f.property === 'abnormalFlagLogic')
      .flatMap((f) => m.priv.flattenValidationMessages(f, 'Row 7'));
  };

  it('a made-up word fails validation, so the test is skipped and nothing is saved', async () => {
    const out = await messagesFor('Sparkly');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rowLabel: 'Row 7',
      column: 'abnormal flag logic',
    });
  });

  it('the message names the word that was typed and lists the labels users see (never enum codes)', async () => {
    const [first] = await messagesFor('Sparkly');
    const text = first!.message;
    expect(text).toContain('"Sparkly"');
    expect(text).toContain('Bold and Red');
    expect(text).toContain('Colour Highlight');
    expect(text).toContain('Bold Italic');
    expect(text).not.toMatch(/[A-Z]+_[A-Z_]+/);
  });

  it('the message says the "with High and Low" styles are for Quantitative results only', async () => {
    const [first] = await messagesFor('Sparkly');
    expect(first!.message).toMatch(
      /For Quantitative results only, you can also use: Red with High and Low/,
    );
    const basicPart = first!.message.split('For Quantitative results only')[0]!;
    expect(basicPart).not.toContain('with High and Low');
  });

  it('a very long made-up value is cut short in the message', async () => {
    const [first] = await messagesFor('x'.repeat(200));
    expect(first!.message).not.toContain('x'.repeat(100));
  });

  it('every real label (any letter case) and a blank cell pass validation', async () => {
    for (const typed of [
      'Red',
      'bold italic',
      'UNDERLINE',
      'Colour Highlight',
      'Bold Italic and Red with High and Low',
      '',
    ]) {
      expect(await messagesFor(typed)).toEqual([]);
    }
  });

  it('a "with High and Low" label on a Qualitative or Semi-Quantitative parameter is refused, with the type in the message', () => {
    const m = build();
    for (const resultType of [
      ResultType.QUALITATIVE,
      ResultType.SEMI_QUANTITATIVE,
    ]) {
      let caught: unknown;
      try {
        m.priv.assertImportParam({
          parameterName: 'Glucose',
          parameterCode: 'GLU',
          resultType,
          abnormalFlagLogic: m.priv.coerceCellValue(
            'abnormalFlagLogic',
            'Red with High and Low',
          ),
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ValidationException);
      const body = (caught as ValidationException).getResponse() as {
        error: { message: string };
      };
      const typeLabel =
        resultType === ResultType.QUALITATIVE
          ? 'Qualitative'
          : 'Semi-quantitative';
      expect(body.error.message).toBe(
        `Parameter "Glucose" (GLU): Abnormal Flag Logic "Red with High and Low" is only available for Quantitative results (this parameter is ${typeLabel})`,
      );
    }
  });

  it('the same label is fine on a Quantitative parameter, and a basic label is fine on every type', () => {
    const m = build();
    for (const [typed, resultType] of [
      ['Red with High and Low', ResultType.QUANTITATIVE],
      ['Underline', ResultType.QUALITATIVE],
      ['Colour Highlight', ResultType.SEMI_QUANTITATIVE],
    ] as const) {
      expect(() =>
        m.priv.assertImportParam({
          parameterName: 'Glucose',
          parameterCode: 'GLU',
          resultType,
          abnormalFlagLogic: m.priv.coerceCellValue('abnormalFlagLogic', typed),
        }),
      ).not.toThrow();
    }
  });
});
