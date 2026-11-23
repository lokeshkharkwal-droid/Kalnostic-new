import ExcelJS from 'exceljs';
import { LabTestService } from './lab-test.service';
import { XLSX_COLUMNS, XLSX_SHEET_NAME } from './dto/import-lab-tests-xlsx.dto';

/**
 * Excel import of the Abnormal Flag Logic column, end to end: a real workbook with the real headers goes through the
 * real import code; only the database calls are stubbed.
 *
 * Two things the user sees in the import result:
 *  - a test with a "…with High and Low" style on a non-Quantitative parameter is skipped, and the message names EVERY such
 *    parameter (not only the first), so one pass fixes the file;
 *  - a file from before the change (old "ABNORMAL FLAG LOGIC" columns in the Reference Range / Reference Value blocks) still
 *    imports, but the result says those columns were ignored instead of dropping their styles silently.
 */
describe('LabTestService.importXlsx — Abnormal Flag Logic', () => {
  type Internals = {
    namesToIds: () => Promise<Map<string, string>>;
    assertCatalogueRefs: () => Promise<void>;
    createSamples: () => Promise<void>;
    createParams: () => Promise<void>;
  };

  let service: LabTestService;
  let nextId = 0;

  type Rows = Array<Record<string, string>>;

  /** A workbook with the real headers (minus `dropHeaders`, plus `extraHeaders` at the end); one row per entry. */
  const workbook = async (
    rows: Rows,
    opts: { dropHeaders?: string[]; extraHeaders?: string[] } = {},
  ): Promise<Buffer> => {
    const headers = [
      ...XLSX_COLUMNS.filter((h) => !(opts.dropHeaders ?? []).includes(h)),
      ...(opts.extraHeaders ?? []),
    ];
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(XLSX_SHEET_NAME);
    sheet.addRow(headers);
    for (const cells of rows) {
      const row: string[] = headers.map(() => '');
      for (const [header, text] of Object.entries(cells)) {
        const at = headers.indexOf(header);
        if (at < 0) throw new Error(`unknown column "${header}"`);
        row[at] = text;
      }
      sheet.addRow(row);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  };

  /** The first row of a test: its scalars, one sample and its first parameter. */
  const testRow = (code: string, param: Record<string, string>) => ({
    'Test Name': `Test ${code}`,
    'Test Code': code,
    'Sample Name': 'Serum-Gel',
    ...param,
  });

  /** A result parameter's columns (the rows after a test's first row carry only these). */
  const param = (
    name: string,
    code: string,
    resultType: string,
    style?: string,
  ): Record<string, string> => ({
    'Parameter Name': name,
    'Parameter Code': code,
    'Result type': resultType,
    'parameter type': 'Measured',
    ...(style === undefined ? {} : { 'abnormal flag logic': style }),
  });

  const run = async (
    rows: Rows,
    opts?: { dropHeaders?: string[]; extraHeaders?: string[] },
  ) => service.importXlsx('md1', 't1', 'p1', await workbook(rows, opts));

  beforeEach(() => {
    nextId = 0;
    const tx = {
      labTest: {
        create: jest.fn(() => Promise.resolve({ id: `lt-${++nextId}` })),
        update: jest.fn(() => Promise.resolve({})),
        findUnique: jest.fn(() => Promise.resolve(null)),
      },
      labTestSample: { updateMany: jest.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      withTenant: jest.fn((_tenant: string, cb: (t: typeof tx) => unknown) =>
        cb(tx),
      ),
      labTest: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        findMany: jest.fn(() => Promise.resolve([])),
      },
    };
    const masterData = {
      findById: jest.fn(() => Promise.resolve({ id: 'md1', branchId: null })),
    };
    service = new LabTestService(prisma as never, masterData as never);
    const internals = service as unknown as Internals;
    jest.spyOn(internals, 'namesToIds').mockResolvedValue(new Map());
    jest.spyOn(internals, 'assertCatalogueRefs').mockResolvedValue(undefined);
    jest.spyOn(internals, 'createParams').mockResolvedValue(undefined);
    jest.spyOn(internals, 'createSamples').mockResolvedValue(undefined);
  });

  describe('a "…with High and Low" style on a non-Quantitative parameter', () => {
    it('skips the test and names the parameter in the message', async () => {
      const result = await run([
        testRow(
          'T1',
          param('Glucose', 'GLU', 'Qualitative', 'Red with High and Low'),
        ),
      ]);

      expect(result.created).toBe(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.errors.map((e) => e.message)).toEqual([
        'Parameter "Glucose" (GLU): Abnormal Flag Logic "Red with High and Low" is only available for Quantitative results (this parameter is Qualitative)',
      ]);
    });

    it('reports EVERY such parameter of the test, each by name, not only the first', async () => {
      const result = await run([
        testRow(
          'T1',
          param('Glucose', 'GLU', 'Qualitative', 'Red with High and Low'),
        ),
        param(
          'Protein',
          'PROT',
          'Semi-Quantitative',
          'Bold and Red with High and Low',
        ),
        param('pH', 'PH', 'Quantitative', 'Red with High and Low'), // fine: Quantitative
      ]);

      const messages = result.skipped.flatMap((s) =>
        s.errors.map((e) => e.message),
      );
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain('Parameter "Glucose" (GLU)');
      expect(messages[0]).toContain('this parameter is Qualitative');
      expect(messages[1]).toContain('Parameter "Protein" (PROT)');
      expect(messages[1]).toContain('this parameter is Semi-quantitative');
      expect(messages.join(' ')).not.toContain('"pH"');
    });

    it('saves nothing for that test but still saves the other tests of the file', async () => {
      const result = await run([
        testRow(
          'BAD',
          param('Glucose', 'GLU', 'Qualitative', 'Red with High and Low'),
        ),
        testRow(
          'GOOD',
          param('pH', 'PH', 'Quantitative', 'Red with High and Low'),
        ),
      ]);

      expect(result.created).toBe(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.rowLabel).toBe('Row 2');
    });

    it('lets the same style through on a Quantitative parameter and every basic style on any type', async () => {
      const result = await run([
        testRow(
          'T1',
          param('pH', 'PH', 'Quantitative', 'Red with High and Low'),
        ),
        testRow('T2', param('Glucose', 'GLU', 'Qualitative', 'Underline')),
        testRow(
          'T3',
          param('Protein', 'PROT', 'Semi-Quantitative', 'Colour Highlight'),
        ),
      ]);

      expect(result.skipped).toEqual([]);
      expect(result.created).toBe(3);
    });
  });

  describe('a file exported before the style moved to the parameter', () => {
    const OLD = 'ABNORMAL FLAG LOGIC';

    it('says nothing for a current file', async () => {
      const result = await run([
        testRow('T1', param('pH', 'PH', 'Quantitative', 'Bold')),
      ]);

      expect(result.skipped).toEqual([]);
      expect(result.ignoredColumnNotices).toEqual([]);
    });

    it('still imports, and says the two old columns were ignored (no parameter column in the file)', async () => {
      const result = await run(
        [testRow('T1', param('pH', 'PH', 'Quantitative'))],
        { dropHeaders: ['abnormal flag logic'], extraHeaders: [OLD, OLD] },
      );

      expect(result.skipped).toEqual([]);
      expect(result.created).toBe(1);
      expect(result.ignoredColumnNotices).toHaveLength(1);
      const [notice] = result.ignoredColumnNotices;
      expect(notice).toContain('2 "ABNORMAL FLAG LOGIC" column(s)');
      expect(notice).toContain('kept their current style');
      expect(notice).toContain('saved without a style');
    });

    it('a file with BOTH the new column and the old ones reads the new one and mentions the old ones', async () => {
      const result = await run(
        [testRow('T1', param('pH', 'PH', 'Quantitative', 'Italic'))],
        { extraHeaders: [OLD] },
      );

      expect(result.skipped).toEqual([]);
      expect(result.ignoredColumnNotices).toHaveLength(1);
      expect(result.ignoredColumnNotices[0]).toContain(
        '1 "ABNORMAL FLAG LOGIC" column(s)',
      );
      expect(result.ignoredColumnNotices[0]).toContain(
        'own "abnormal flag logic" column',
      );
    });

    it('the old column in a different letter case is still spotted', async () => {
      const result = await run(
        [testRow('T1', param('pH', 'PH', 'Quantitative'))],
        {
          dropHeaders: ['abnormal flag logic'],
          extraHeaders: ['Abnormal Flag Logic'],
        },
      );

      expect(result.ignoredColumnNotices).toHaveLength(1);
    });
  });
});
