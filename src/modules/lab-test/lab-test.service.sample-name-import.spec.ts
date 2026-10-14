import ExcelJS from 'exceljs';
import { LabTestService } from './lab-test.service';
import { XLSX_COLUMNS, XLSX_SHEET_NAME } from './dto/import-lab-tests-xlsx.dto';

/**
 * Excel import of the Sample Name column, end to end: a real workbook with the real headers goes through the real
 * import code; only the database calls are stubbed.
 *
 * Rule under test: a name that is a standard sample name apart from capitals, spacing or punctuation is saved
 * with the standard spelling; every other name is saved exactly as typed; nothing is ever rejected for its
 * sample name, and the result lists the names that are not standard (`sampleNameNotices`).
 */
describe('LabTestService.importXlsx — Sample Name', () => {
  type SampleArg = { sampleName?: string };
  type Internals = {
    namesToIds: () => Promise<Map<string, string>>;
    assertCatalogueRefs: () => Promise<void>;
    createSamples: (
      tx: unknown,
      tenantId: string,
      branchId: string | null,
      labTestId: string,
      samples: SampleArg[],
    ) => Promise<void>;
    createParams: () => Promise<void>;
  };

  let service: LabTestService;
  let createSamples: jest.SpyInstance<
    Promise<void>,
    Parameters<Internals['createSamples']>
  >;
  let nextId = 0;

  /** A workbook with one row per entry; each entry maps a column header to the cell text. */
  const workbook = async (
    rows: Array<Record<string, string>>,
  ): Promise<Buffer> => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(XLSX_SHEET_NAME);
    sheet.addRow([...XLSX_COLUMNS]);
    for (const cells of rows) {
      const row: string[] = XLSX_COLUMNS.map(() => '');
      for (const [header, text] of Object.entries(cells)) {
        const at = (XLSX_COLUMNS as readonly string[]).indexOf(header);
        if (at < 0) throw new Error(`unknown column "${header}"`);
        row[at] = text;
      }
      sheet.addRow(row);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  };

  /** One new test with one sample. */
  const test = (code: string, sampleName: string) => ({
    'Test Name': `Test ${code}`,
    'Test Code': code,
    'Sample Name': sampleName,
  });

  const run = async (rows: Array<Record<string, string>>) =>
    service.importXlsx('md1', 't1', 'p1', await workbook(rows));

  /** The sample names handed to the database for the nth test written. */
  const savedNames = (nth: number): Array<string | undefined> =>
    createSamples.mock.calls[nth]![4].map((s) => s.sampleName);

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
    createSamples = jest
      .spyOn(internals, 'createSamples')
      .mockResolvedValue(undefined);
  });

  it('saves a standard name unchanged and reports nothing', async () => {
    const result = await run([test('T1', 'Serum-Gel')]);

    expect(result.skipped).toEqual([]);
    expect(result.created).toBe(1);
    expect(savedNames(0)).toEqual(['Serum-Gel']);
    expect(result.sampleNameNotices).toEqual([]);
  });

  it('saves a name that differs only by capitals / punctuation under the standard spelling', async () => {
    const result = await run([
      test('T1', 'Pleural fluid'),
      test('T2', 'Serum (Plain)'),
    ]);

    expect(result.skipped).toEqual([]);
    expect(savedNames(0)).toEqual(['Pleural Fluid']);
    expect(savedNames(1)).toEqual(['Serum-Plain']);
    expect(result.sampleNameNotices).toEqual([
      { name: 'Pleural fluid', mappedTo: 'Pleural Fluid', tests: 1 },
      { name: 'Serum (Plain)', mappedTo: 'Serum-Plain', tests: 1 },
    ]);
  });

  it('accepts a name that is not a standard name, saves it exactly as typed, and reports it', async () => {
    const result = await run([
      test('T1', 'X-Ray'),
      test('T2', 'X-Ray'),
      test('T3', 'Urine-R'),
    ]);

    expect(result.skipped).toEqual([]); // nothing is rejected
    expect(result.created).toBe(3);
    expect(savedNames(0)).toEqual(['X-Ray']);
    expect(savedNames(2)).toEqual(['Urine-R']);
    expect(result.sampleNameNotices).toEqual([
      { name: 'X-Ray', tests: 2 },
      { name: 'Urine-R', tests: 1 },
    ]);
  });

  it('handles a mix in one file, with the standard names left alone', async () => {
    const result = await run([
      test('T1', 'Serum-Gel'),
      test('T2', 'WB-EDTA'),
      test('T3', 'Ascitic fluid'),
      test('T4', 'Body Height'),
    ]);

    expect(result.created).toBe(4);
    expect(result.skipped).toEqual([]);
    expect([0, 1, 2, 3].map((i) => savedNames(i)[0])).toEqual([
      'Serum-Gel',
      'WB-EDTA',
      'Ascitic Fluid',
      'Body Height',
    ]);
    expect(result.sampleNameNotices.map((n) => n.name).sort()).toEqual([
      'Ascitic fluid',
      'Body Height',
    ]);
  });

  it('still allows a sample that has no name (only a type)', async () => {
    const result = await run([{ ...test('T1', ''), 'Sample Type': 'Blood' }]);

    expect(result.skipped).toEqual([]);
    expect(result.created).toBe(1);
    expect(savedNames(0)).toEqual([undefined]);
    expect(result.sampleNameNotices).toEqual([]);
  });

  it('does not report a name from a test that was skipped for another reason', async () => {
    // The same Test Code twice: both rows are skipped as duplicates, so nothing they held was saved.
    const result = await run([
      test('DUP', 'X-Ray'),
      test('DUP', 'X-Ray'),
      test('OK', 'Urine-R'),
    ]);

    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.created).toBe(1);
    expect(result.sampleNameNotices).toEqual([{ name: 'Urine-R', tests: 1 }]);
  });
});
