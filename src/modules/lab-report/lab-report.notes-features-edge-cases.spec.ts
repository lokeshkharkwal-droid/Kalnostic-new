import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { UpdateParameterNoteDto } from './dto/update-parameter-note.dto';
import { UpdateContentSectionsDto } from './dto/update-content-sections.dto';
import { LabReportParameterNoteNotEditableException } from './exceptions/lab-report.exceptions';
import { NOTE_MAX_LENGTH } from '../../common/validators/note-max-length.validator';

/**
 * Edge cases of the two features that were fixed together:
 *   1. the technician's PARAMETER NOTE on a report (blank vs never written, sanitising, size, status);
 *   2. the five NOTES SECTIONS on a report (Useful For, Interpretation, Limitations, Remarks, References).
 * The Print selection has its own spec (`lab-report.notes-print-edge-cases.spec.ts`).
 */
jest.setTimeout(30_000);

// ═════════════════════════════════════════════════════════════════════════════
describe('1a. parameter note request: validation and cleaning', () => {
  // the same conversion the real request pipe applies (main.ts: enableImplicitConversion)
  const parse = (body: unknown) =>
    plainToInstance(UpdateParameterNoteDto, body as object, {
      enableImplicitConversion: true,
    });
  const errors = (body: unknown) => validate(parse(body));

  it('accepts text, formatted text and an EMPTY string (the empty string means "no note on this report")', async () => {
    for (const content of [
      'Hemolysed',
      '<p><strong>Hemolysed</strong></p>',
      '',
    ]) {
      expect(await errors({ content })).toHaveLength(0);
    }
  });

  it.each([
    ['missing', {}],
    ['null', { content: null }],
    ['a number', { content: 5 }],
    ['an object', { content: { a: 1 } }],
    ['an array', { content: ['x'] }],
    ['a boolean', { content: true }],
  ])(
    'rejects content that is %s (it must never be turned into text like "5" or "[object Object]")',
    async (_n, body) => {
      expect((await errors(body)).length).toBeGreaterThan(0);
    },
  );

  it('accepts exactly the size limit and rejects one character more', async () => {
    expect(await errors({ content: 'a'.repeat(NOTE_MAX_LENGTH) })).toHaveLength(
      0,
    );
    expect(
      (await errors({ content: 'a'.repeat(NOTE_MAX_LENGTH + 1) })).length,
    ).toBeGreaterThan(0);
  });

  it('strips anything active before it is stored, and keeps the formatting', () => {
    const dto = parse({
      content:
        '<p onclick="x()">Hi <strong>there</strong></p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">l</a><iframe src="https://evil"></iframe>',
    });
    expect(dto.content).toContain('<strong>there</strong>');
    expect(dto.content).not.toMatch(
      /<script|onclick|onerror|javascript:|<iframe/i,
    );
  });

  it('plain text and an empty string come back unchanged', () => {
    expect(parse({ content: 'plain text' }).content).toBe('plain text');
    expect(parse({ content: '' }).content).toBe('');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('1b. parameter note save: the report row', () => {
  function makeService(
    status: LabReportStatus,
    freshStatus: LabReportStatus = status,
  ) {
    const upsert = jest.fn().mockResolvedValue({});
    const tx = {
      labReport: {
        findFirst: jest.fn().mockResolvedValue({ status: freshStatus }),
      },
      labReportParameterNote: { upsert },
    };
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      requireBranch: (b: string) => b,
      requireReport: jest.fn().mockResolvedValue({
        id: 'r1',
        status,
        labTestId: 'lt1',
        orderItemId: 'item1',
      }),
      getResultParams: jest.fn().mockResolvedValue([{ id: 'p1' }]),
      lockReportForWrite: jest.fn().mockResolvedValue(undefined),
      prisma: {
        orderItem: {
          findUnique: jest.fn().mockResolvedValue({ branchLabPanelId: null }),
        },
        withTenant: (_t: string, fn: (t: typeof tx) => Promise<void>) => fn(tx),
      },
    });
    return { svc, upsert };
  }
  const save = (svc: LabReportService, content: string) =>
    svc.updateParameterNote('r1', 't1', 'A', 'p1', { content });

  it('saving the SAME text twice writes the same single row (an upsert on report + parameter, no second row)', async () => {
    const { svc, upsert } = makeService(LabReportStatus.SAVED);
    await save(svc, 'same');
    await save(svc, 'same');
    expect(upsert).toHaveBeenCalledTimes(2);
    const keys = upsert.mock.calls.map((c) =>
      JSON.stringify(((c as unknown[])[0] as { where: unknown }).where),
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('a save after a Repeat / Re-run revives the soft-deleted row instead of colliding with it', async () => {
    const { svc, upsert } = makeService(LabReportStatus.PENDING);
    await save(svc, 'new text after the reset');
    const arg = (upsert.mock.calls[0] as unknown[])[0] as {
      update: { deletedAt: unknown; content: string };
    };
    expect(arg.update).toEqual({
      content: 'new text after the reset',
      deletedAt: null,
    });
  });

  it('refuses a report past Saved even if the screen still thought it was editable', async () => {
    const { svc, upsert } = makeService(
      LabReportStatus.SAVED,
      LabReportStatus.RESULT_DONE,
    );
    await expect(save(svc, 'late')).rejects.toBeInstanceOf(
      LabReportParameterNoteNotEditableException,
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('stores markup-looking text exactly as given (it was already cleaned by the request)', async () => {
    const { svc, upsert } = makeService(LabReportStatus.SAVED);
    await save(svc, '<p>1 &lt; 2</p>');
    expect(
      (
        (upsert.mock.calls[0] as unknown[])[0] as {
          create: { content: string };
        }
      ).create.content,
    ).toBe('<p>1 &lt; 2</p>');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('2a. Notes sections request', () => {
  const parse = (body: unknown) =>
    plainToInstance(UpdateContentSectionsDto, body as object, {
      enableImplicitConversion: true,
    });

  it('accepts any subset of the five fields, including none and an empty string', async () => {
    for (const body of [
      {},
      { remarks: '' },
      {
        usefulFor: 'u',
        interpretation: 'i',
        limitations: 'l',
        remarks: 'r',
        references: 'f',
      },
    ]) {
      expect(await validate(parse(body))).toHaveLength(0);
    }
  });

  it('rejects a non-string value and anything over the size limit', async () => {
    expect((await validate(parse({ remarks: 5 }))).length).toBeGreaterThan(0);
    expect(
      (await validate(parse({ references: 'a'.repeat(NOTE_MAX_LENGTH + 1) })))
        .length,
    ).toBeGreaterThan(0);
    expect(
      await validate(parse({ references: 'a'.repeat(NOTE_MAX_LENGTH) })),
    ).toHaveLength(0);
  });

  it('cleans every one of the five fields, not just some', () => {
    const dirty = '<p>ok</p><script>alert(1)</script>';
    const dto = parse({
      usefulFor: dirty,
      interpretation: dirty,
      limitations: dirty,
      remarks: dirty,
      references: dirty,
    });
    for (const k of [
      'usefulFor',
      'interpretation',
      'limitations',
      'remarks',
      'references',
    ] as const) {
      expect(dto[k]).toContain('<p>ok</p>');
      expect(dto[k]).not.toMatch(/<script/i);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('2b. Notes sections save: which fields are written', () => {
  type Settings = Partial<
    Record<
      | 'isUsefulForEditable'
      | 'isInterpretationEditable'
      | 'isLimitationsEditable'
      | 'isRemarksEditable'
      | 'isReferencesEditable',
      boolean
    >
  >;

  function makeService(
    settings: Settings,
    status: LabReportStatus = LabReportStatus.SAVED,
  ) {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      labReport: { findFirst: jest.fn().mockResolvedValue({ status }), update },
    };
    const stored = {
      labTestId: 'lt1',
      usefulFor: null,
      interpretationOfResults: null,
      limitations: null,
      remarks: null,
      references: null,
    };
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      requireBranch: (b: string) => b,
      requireReport: jest
        .fn()
        .mockResolvedValue({ id: 'r1', status, branchId: 'A' }),
      lockReportForWrite: jest.fn().mockResolvedValue(undefined),
      technicianSettingsService: {
        getForBranch: jest.fn().mockResolvedValue({
          isUsefulForEditable: false,
          isInterpretationEditable: false,
          isLimitationsEditable: false,
          isRemarksEditable: false,
          isReferencesEditable: false,
          ...settings,
        }),
      },
      getContentSections: jest.fn().mockResolvedValue({}),
      prisma: {
        labReport: { findFirstOrThrow: jest.fn().mockResolvedValue(stored) },
        withTenant: (_t: string, fn: (t: typeof tx) => Promise<void>) => fn(tx),
      },
    });
    return { svc, update };
  }
  const ALL = {
    usefulFor: 'U',
    interpretation: 'I',
    limitations: 'L',
    remarks: 'R',
    references: 'F',
  };

  it('every editable switch OFF: nothing is written and nothing fails (the request is silently ignored)', async () => {
    const { svc, update } = makeService({});
    await expect(
      svc.updateContentSections('r1', 't1', 'A', ALL),
    ).resolves.toBeDefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('only the fields whose switch is ON are written, each into its own column', async () => {
    const { svc, update } = makeService({
      isRemarksEditable: true,
      isUsefulForEditable: true,
    });
    await svc.updateContentSections('r1', 't1', 'A', ALL);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { usefulFor: 'U', remarks: 'R' },
    });
  });

  it('all five switches ON: the five map to the right columns (interpretation -> interpretationOfResults)', async () => {
    const { svc, update } = makeService({
      isUsefulForEditable: true,
      isInterpretationEditable: true,
      isLimitationsEditable: true,
      isRemarksEditable: true,
      isReferencesEditable: true,
    });
    await svc.updateContentSections('r1', 't1', 'A', ALL);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        usefulFor: 'U',
        interpretationOfResults: 'I',
        limitations: 'L',
        remarks: 'R',
        references: 'F',
      },
    });
  });

  it('an EMPTY string is a real erase and is written (it is not skipped as "nothing")', async () => {
    const { svc, update } = makeService({ isRemarksEditable: true });
    await svc.updateContentSections('r1', 't1', 'A', { remarks: '' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { remarks: '' },
    });
  });

  it('a field that is not in the request is left alone', async () => {
    const { svc, update } = makeService({
      isRemarksEditable: true,
      isReferencesEditable: true,
    });
    await svc.updateContentSections('r1', 't1', 'A', { remarks: 'only this' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { remarks: 'only this' },
    });
  });

  it('an empty request writes nothing', async () => {
    const { svc, update } = makeService({ isRemarksEditable: true });
    await svc.updateContentSections('r1', 't1', 'A', {});
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    LabReportStatus.VALIDATION_PENDING,
    LabReportStatus.RESULT_DONE,
    LabReportStatus.APPROVED,
    LabReportStatus.PUBLISHED,
  ])(
    'is refused once the report is %s, even when every switch is ON',
    async (status) => {
      const { svc, update } = makeService({ isRemarksEditable: true }, status);
      await expect(
        svc.updateContentSections('r1', 't1', 'A', ALL),
      ).rejects.toBeInstanceOf(LabReportParameterNoteNotEditableException);
      expect(update).not.toHaveBeenCalled();
    },
  );
});

// ═════════════════════════════════════════════════════════════════════════════
describe("2c. Notes sections shown: the report's own text, else the test's", () => {
  function makeService(master: Record<string, string | null> | null) {
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      prisma: { labTest: { findFirst: jest.fn().mockResolvedValue(master) } },
    });
    return (
      svc as unknown as {
        getContentSections: (
          t: string,
          labTestId: string | null,
          own: Record<string, string | null>,
        ) => Promise<Record<string, string | null>>;
      }
    ).getContentSections.bind(svc);
  }
  const NONE = {
    usefulFor: null,
    interpretationOfResults: null,
    limitations: null,
    remarks: null,
    references: null,
  };
  const MASTER = {
    usefulFor: 'mU',
    interpretationOfResults: 'mI',
    limitations: 'mL',
    remarks: 'mR',
    references: 'mF',
  };

  it("with no text of its own every section shows the test's configured text (this is what Re-run goes back to)", async () => {
    const get = makeService(MASTER);
    expect(await get('t1', 'lt1', NONE)).toEqual({
      usefulFor: 'mU',
      interpretation: 'mI',
      limitations: 'mL',
      remarks: 'mR',
      references: 'mF',
    });
  });

  it('an EMPTY own text wins: the section is deliberately blank and the configured text does not come back', async () => {
    const get = makeService(MASTER);
    const out = await get('t1', 'lt1', { ...NONE, remarks: '' });
    expect(out.remarks).toBe('');
    expect(out.usefulFor).toBe('mU');
  });

  it('own text wins field by field; the other fields keep falling back', async () => {
    const get = makeService(MASTER);
    const out = await get('t1', 'lt1', {
      ...NONE,
      interpretationOfResults: 'mine',
    });
    expect(out.interpretation).toBe('mine');
    expect(out.limitations).toBe('mL');
  });

  it('a report with no linked test (a free-text line) and no text of its own shows nothing', async () => {
    const get = makeService(null);
    expect(await get('t1', null, NONE)).toEqual({
      usefulFor: null,
      interpretation: null,
      limitations: null,
      remarks: null,
      references: null,
    });
  });

  it('a linked test that no longer exists falls back to nothing, not an error', async () => {
    const get = makeService(null);
    expect(await get('t1', 'gone', NONE)).toEqual({
      usefulFor: null,
      interpretation: null,
      limitations: null,
      remarks: null,
      references: null,
    });
  });

  it("the test's own null fields stay null", async () => {
    const get = makeService({ ...MASTER, usefulFor: null });
    expect((await get('t1', 'lt1', NONE)).usefulFor).toBeNull();
  });
});
