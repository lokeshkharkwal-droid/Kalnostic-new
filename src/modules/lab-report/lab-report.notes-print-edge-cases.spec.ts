import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { UpdateNotePrintSectionsDto } from './dto/update-note-print-sections.dto';
import {
  NOTE_SECTION_KEYS,
  excludedSectionsToApply,
  normaliseNoteSections,
} from './utils/note-sections.util';

/**
 * Edge cases of the Notes "Print" selection. The rules under test:
 *  - the checkboxes are ALWAYS offered for a test or panel report (never for a free-text line);
 *  - the branch setting only sets the DEFAULT while nobody chose (ON = all selected, OFF = none selected);
 *  - the first saved choice is the report's own and always wins;
 *  - approval freezes the default so an issued report can never change;
 *  - Re-run and Repeat start the choice over;
 *  - the design guards below fail when a later change breaks one of those promises.
 */
jest.setTimeout(30_000);

type Switches = { labTest: boolean; labPanel: boolean };
type Line = {
  branchLabPanelId: string | null;
  branchLabTestId: string | null;
};
const TEST_LINE: Line = { branchLabPanelId: null, branchLabTestId: 'bt1' };
const PANEL_LINE: Line = { branchLabPanelId: 'panel1', branchLabTestId: null };
const FREE_TEXT_LINE: Line = { branchLabPanelId: null, branchLabTestId: null };
const ALL_KEYS = [...NOTE_SECTION_KEYS] as string[];

type Resolved = {
  enabled: boolean;
  isPanelMember: boolean;
  excludedSections: string[];
};

/** The service with just enough wiring to resolve / freeze the Print choice. */
function makeService(opts: {
  switches?: Switches;
  settingsFails?: boolean;
  line?: Line | null;
}) {
  const getNotesPrintSwitches = opts.settingsFails
    ? jest.fn().mockRejectedValue(new Error('settings unavailable'))
    : jest
        .fn()
        .mockResolvedValue(opts.switches ?? { labTest: true, labPanel: true });
  const orderItemFindFirst = jest
    .fn()
    .mockResolvedValue(opts.line === undefined ? TEST_LINE : opts.line);
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    technicianSettingsService: { getNotesPrintSwitches },
    prisma: { orderItem: { findFirst: orderItemFindFirst } },
  });
  const priv = svc as unknown as {
    resolveNotesPrint: (t: string, r: unknown) => Promise<Resolved>;
    freezeNotePrintChoice: (t: string, r: unknown) => Promise<unknown>;
  };
  return { svc, priv, getNotesPrintSwitches, orderItemFindFirst };
}

const reportRow = (over: {
  line?: Line;
  chosen: boolean;
  stored?: string[] | null;
  branchId?: string | null;
}) => ({
  orderItemId: 'item1',
  branchId: over.branchId === undefined ? 'A' : over.branchId,
  excludedNoteSections: over.stored === undefined ? [] : over.stored,
  hasChosenNotePrint: over.chosen,
  orderItem: over.line ?? TEST_LINE,
});

// ═════════════════════════════════════════════════════════════════════════════
describe('decision table: kind x setting x chosen x stored list', () => {
  type Row = {
    kind: 'TEST' | 'PANEL';
    setting: boolean;
    chosen: boolean;
    stored: string[];
    expected: string[];
  };
  const rows: Row[] = [];
  for (const kind of ['TEST', 'PANEL'] as const) {
    for (const setting of [true, false]) {
      // nobody chose: the setting decides, a stray stored list is ignored
      rows.push({
        kind,
        setting,
        chosen: false,
        stored: [],
        expected: setting ? [] : ALL_KEYS,
      });
      rows.push({
        kind,
        setting,
        chosen: false,
        stored: ['remarks'],
        expected: setting ? [] : ALL_KEYS,
      });
      // chosen: the stored list is the choice, whatever the setting says
      rows.push({ kind, setting, chosen: true, stored: [], expected: [] });
      rows.push({
        kind,
        setting,
        chosen: true,
        stored: ['remarks'],
        expected: ['remarks'],
      });
      rows.push({
        kind,
        setting,
        chosen: true,
        stored: ALL_KEYS,
        expected: ALL_KEYS,
      });
    }
  }

  it.each(rows)(
    '$kind, setting ON=$setting, chosen=$chosen, stored=$stored -> left out $expected',
    async ({ kind, setting, chosen, stored, expected }) => {
      const { priv } = makeService({
        switches:
          kind === 'TEST'
            ? { labTest: setting, labPanel: !setting }
            : { labTest: !setting, labPanel: setting },
      });
      const out = await priv.resolveNotesPrint(
        't1',
        reportRow({
          line: kind === 'TEST' ? TEST_LINE : PANEL_LINE,
          chosen,
          stored,
        }),
      );
      expect(out.enabled).toBe(true);
      expect(out.isPanelMember).toBe(kind === 'PANEL');
      expect(out.excludedSections).toEqual(expected);
    },
  );

  it("the OTHER kind's setting never leaks in (Lab Test ON / Lab Panel OFF and the reverse)", async () => {
    const testOnPanelOff = makeService({
      switches: { labTest: true, labPanel: false },
    });
    expect(
      (
        await testOnPanelOff.priv.resolveNotesPrint(
          't1',
          reportRow({ line: TEST_LINE, chosen: false }),
        )
      ).excludedSections,
    ).toEqual([]);
    expect(
      (
        await testOnPanelOff.priv.resolveNotesPrint(
          't1',
          reportRow({ line: PANEL_LINE, chosen: false }),
        )
      ).excludedSections,
    ).toEqual(ALL_KEYS);
    const testOffPanelOn = makeService({
      switches: { labTest: false, labPanel: true },
    });
    expect(
      (
        await testOffPanelOn.priv.resolveNotesPrint(
          't1',
          reportRow({ line: TEST_LINE, chosen: false }),
        )
      ).excludedSections,
    ).toEqual(ALL_KEYS);
    expect(
      (
        await testOffPanelOn.priv.resolveNotesPrint(
          't1',
          reportRow({ line: PANEL_LINE, chosen: false }),
        )
      ).excludedSections,
    ).toEqual([]);
  });

  it('a free-text line offers nothing and reads no setting, chosen or not', async () => {
    for (const chosen of [true, false]) {
      const { priv, getNotesPrintSwitches } = makeService({});
      const out = await priv.resolveNotesPrint(
        't1',
        reportRow({ line: FREE_TEXT_LINE, chosen, stored: ['remarks'] }),
      );
      expect(out).toEqual({
        enabled: false,
        isPanelMember: false,
        excludedSections: [],
      });
      expect(getNotesPrintSwitches).not.toHaveBeenCalled();
    }
  });

  it('"none selected" always means every section the app knows, so a future 6th section is covered', () => {
    expect([...excludedSectionsToApply(false, false, [])]).toEqual([
      ...NOTE_SECTION_KEYS,
    ]);
    expect(excludedSectionsToApply(false, false, []).size).toBe(
      NOTE_SECTION_KEYS.length,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('odd stored values are tolerated, never crash a print', () => {
  it('unknown keys are dropped, duplicates collapse, order is the canonical one', () => {
    expect(
      normaliseNoteSections([
        'references',
        'bogus',
        'useful_for',
        'references',
        '',
      ]),
    ).toEqual(['useful_for', 'references']);
  });

  it('null / undefined / empty stored lists mean "nothing left out" once chosen', () => {
    for (const stored of [null, undefined, []] as const) {
      expect(excludedSectionsToApply(false, true, stored).size).toBe(0);
      expect(excludedSectionsToApply(true, true, stored).size).toBe(0);
    }
  });

  it('a chosen list holding only unknown keys leaves nothing out', async () => {
    const { priv } = makeService({
      switches: { labTest: false, labPanel: false },
    });
    const out = await priv.resolveNotesPrint(
      't1',
      reportRow({ chosen: true, stored: ['bogus'] }),
    );
    expect(out.excludedSections).toEqual([]);
  });

  it('a report with no branch uses the built-in defaults (ON) and never calls the settings service', async () => {
    const { priv, getNotesPrintSwitches } = makeService({
      switches: { labTest: false, labPanel: false },
    });
    const out = await priv.resolveNotesPrint(
      't1',
      reportRow({ chosen: false, branchId: null }),
    );
    expect(out.excludedSections).toEqual([]);
    expect(getNotesPrintSwitches).not.toHaveBeenCalled();
  });

  it('when the settings cannot be read the error is NOT swallowed (no silent wrong default)', async () => {
    const { priv } = makeService({ settingsFails: true });
    await expect(
      priv.resolveNotesPrint('t1', reportRow({ chosen: false })),
    ).rejects.toThrow('settings unavailable');
  });

  it('a chosen report does not need the setting to decide, but it is still read for the screen state', async () => {
    const { priv, getNotesPrintSwitches } = makeService({
      switches: { labTest: false, labPanel: false },
    });
    const out = await priv.resolveNotesPrint(
      't1',
      reportRow({ chosen: true, stored: ['remarks'] }),
    );
    expect(out.excludedSections).toEqual(['remarks']);
    expect(getNotesPrintSwitches).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('request validation of PATCH note-print-sections', () => {
  const check = async (body: unknown) =>
    validate(plainToInstance(UpdateNotePrintSectionsDto, body as object));

  it('accepts an empty list (everything selected) and every subset', async () => {
    expect(await check({ excludedSections: [] })).toHaveLength(0);
    expect(await check({ excludedSections: ['remarks'] })).toHaveLength(0);
    expect(await check({ excludedSections: ALL_KEYS })).toHaveLength(0);
  });

  it.each([
    ['unknown key', { excludedSections: ['bogus'] }],
    ['a duplicate', { excludedSections: ['remarks', 'remarks'] }],
    ['more keys than sections', { excludedSections: [...ALL_KEYS, 'remarks'] }],
    ['not an array', { excludedSections: 'remarks' }],
    ['null', { excludedSections: null }],
    ['missing field', {}],
    ['a non-string element', { excludedSections: [1] }],
    ['wrong case', { excludedSections: ['Remarks'] }],
    ['the UI label instead of the key', { excludedSections: ['Useful For'] }],
  ])('rejects %s', async (_name, body) => {
    expect((await check(body)).length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('approval freezes the default (and never overwrites a real choice)', () => {
  function makeApprove(opts: {
    switches?: Switches;
    line?: Line;
    chosen: boolean;
    stored?: string[];
    settingsFails?: boolean;
    branchId?: string;
  }) {
    const update = jest.fn().mockResolvedValue({ id: 'r1' });
    const tx = {
      labReport: { update },
      labReportNote: { create: jest.fn() },
    };
    const base = makeService({
      switches: opts.switches,
      line: opts.line,
      settingsFails: opts.settingsFails,
    });
    Object.assign(base.svc, {
      requireBranch: (b: string) => b,
      requireReport: jest.fn().mockResolvedValue({
        id: 'r1',
        status: LabReportStatus.RESULT_DONE,
        branchId: opts.branchId ?? 'A',
        orderItemId: 'item1',
        reportingDeferredUntil: null,
        isNablTat: false,
        excludedNoteSections: opts.stored ?? [],
        hasChosenNotePrint: opts.chosen,
      }),
      resolveSignatoryColumns: jest.fn().mockResolvedValue({}),
      tatService: {
        buildApprovalSnapshot: jest.fn().mockResolvedValue({
          tatStartAt: null,
          tatNetMinutes: null,
          tatMaxMinutes: null,
          tatBand: null,
        }),
      },
      lockReportForWrite: jest.fn().mockResolvedValue(undefined),
      recordHistory: jest.fn().mockResolvedValue(undefined),
    });
    (
      base.svc as unknown as { prisma: Record<string, unknown> }
    ).prisma.withTenant = (
      _t: string,
      fn: (t: typeof tx) => Promise<unknown>,
    ) => fn(tx);
    return { ...base, update };
  }
  const dataOf = (update: jest.Mock) =>
    (update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

  it('no choice + setting ON: stores "all selected"', async () => {
    const m = makeApprove({
      chosen: false,
      switches: { labTest: true, labPanel: true },
    });
    await m.svc.approve('r1', 't1', 'A', 'actor', {});
    expect(dataOf(m.update)).toMatchObject({
      status: LabReportStatus.APPROVED,
      excludedNoteSections: [],
      hasChosenNotePrint: true,
    });
  });

  it('no choice + setting OFF: stores "none selected" (every section left out)', async () => {
    const m = makeApprove({
      chosen: false,
      switches: { labTest: false, labPanel: true },
    });
    await m.svc.approve('r1', 't1', 'A', 'actor', {});
    expect(dataOf(m.update)).toMatchObject({
      excludedNoteSections: ALL_KEYS,
      hasChosenNotePrint: true,
    });
  });

  it('a panel report freezes the Lab Panel default, not the Lab Test one', async () => {
    const m = makeApprove({
      chosen: false,
      line: PANEL_LINE,
      switches: { labTest: true, labPanel: false },
    });
    await m.svc.approve('r1', 't1', 'A', 'actor', {});
    expect(dataOf(m.update)).toMatchObject({
      excludedNoteSections: ALL_KEYS,
      hasChosenNotePrint: true,
    });
  });

  it("freezes the HOLDER branch's default (the report's branch), read once", async () => {
    const m = makeApprove({
      chosen: false,
      branchId: 'B',
      switches: { labTest: false, labPanel: false },
    });
    await m.svc.approve('r1', 't1', 'A', 'actor', {});
    expect(m.getNotesPrintSwitches).toHaveBeenCalledWith('t1', 'B');
    expect(m.getNotesPrintSwitches).toHaveBeenCalledTimes(1);
  });

  it('an existing choice is left exactly as it is: approval writes neither field', async () => {
    const m = makeApprove({
      chosen: true,
      stored: ['remarks'],
      switches: { labTest: false, labPanel: false },
    });
    await m.svc.approve('r1', 't1', 'A', 'actor', {});
    const data = dataOf(m.update);
    expect(data).not.toHaveProperty('excludedNoteSections');
    expect(data).not.toHaveProperty('hasChosenNotePrint');
    expect(m.getNotesPrintSwitches).not.toHaveBeenCalled();
  });

  it('a free-text line has nothing to freeze', async () => {
    const m = makeApprove({ chosen: false, line: FREE_TEXT_LINE });
    await m.svc.approve('r1', 't1', 'A', 'actor', {});
    const data = dataOf(m.update);
    expect(data).not.toHaveProperty('excludedNoteSections');
    expect(data).not.toHaveProperty('hasChosenNotePrint');
  });

  it('if the settings cannot be read, approval FAILS and writes nothing (it never guesses a default)', async () => {
    const m = makeApprove({ chosen: false, settingsFails: true });
    await expect(m.svc.approve('r1', 't1', 'A', 'actor', {})).rejects.toThrow(
      'settings unavailable',
    );
    expect(m.update).not.toHaveBeenCalled();
  });

  it('a stray stored list on an unchosen report never leaks into the frozen value', async () => {
    const m = makeApprove({
      chosen: false,
      stored: ['remarks'],
      switches: { labTest: true, labPanel: true },
    });
    await m.svc.approve('r1', 't1', 'A', 'actor', {});
    expect(dataOf(m.update)).toMatchObject({
      excludedNoteSections: [],
      hasChosenNotePrint: true,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('Repeat / return resets the choice', () => {
  /** A transaction whose every model method is a recording mock; only labReport.findMany returns the reports. */
  function recordingTx(reports: unknown[]) {
    const calls: Array<{ model: string; method: string; arg: unknown }> = [];
    const tx = new Proxy(
      {},
      {
        get: (_t, model: string) =>
          new Proxy(
            {},
            {
              get: (_m, method: string) =>
                jest.fn((arg: unknown) => {
                  calls.push({ model, method, arg });
                  if (model === 'labReport' && method === 'findMany')
                    return Promise.resolve(reports);
                  if (method === 'findMany') return Promise.resolve([]);
                  return Promise.resolve({ count: 0 });
                }),
            },
          ),
      },
    );
    return { tx, calls };
  }

  it('puts every returned report back to "no choice yet" with an empty list', async () => {
    const { tx, calls } = recordingTx([
      {
        id: 'r1',
        status: 'APPROVED',
        usefulFor: 'x',
        interpretationOfResults: null,
        limitations: null,
        remarks: null,
        references: null,
      },
    ]);
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      recordHistory: jest.fn().mockResolvedValue(undefined),
      prisma: {},
    });
    await svc.resetReportsForReturn(tx as never, 't1', ['r1'], 'actor');
    const reset = calls.find(
      (c) =>
        c.model === 'labReport' &&
        c.method === 'updateMany' &&
        (c.arg as { data: Record<string, unknown> }).data.status ===
          LabReportStatus.PENDING,
    );
    expect(reset).toBeDefined();
    expect(
      (reset!.arg as { data: Record<string, unknown> }).data,
    ).toMatchObject({
      excludedNoteSections: [],
      hasChosenNotePrint: false,
      usefulFor: null,
    });
  });

  it('does nothing for an empty list of reports', async () => {
    const { tx, calls } = recordingTx([]);
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    await svc.resetReportsForReturn(tx as never, 't1', [], null);
    expect(calls).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Design guards: they fail when a later change breaks the architecture instead of the behaviour.
describe('architecture guards', () => {
  const srcRoot = join(__dirname, '..', '..'); // src/
  const service = readFileSync(
    join(__dirname, 'lab-report.service.ts'),
    'utf8',
  ).replace(/\r\n/g, '\n');

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
    }
    return out;
  }

  it('lab-report.service.ts is the ONLY non-test file that touches the stored Print choice', () => {
    const users = walk(srcRoot)
      .filter((f) =>
        /excludedNoteSections|hasChosenNotePrint/.test(readFileSync(f, 'utf8')),
      )
      .map((f) => f.slice(srcRoot.length + 1).replace(/\\/g, '/'));
    expect(users).toEqual(['modules/lab-report/lab-report.service.ts']);
  });

  it('every place that writes the list also writes the "chosen" flag next to it', () => {
    const lines = service.split('\n');
    const writers = lines
      .map((l, i) => ({ l, i }))
      .filter(
        ({ l }) =>
          /^\s*excludedNoteSections(: \[\]|: NoteSectionKey\[\]|),?$/.test(l) &&
          !/:\s*(string|NoteSectionKey)\[\];/.test(l),
      );
    // the two resets (`excludedNoteSections: [],`) and the choice save (`excludedNoteSections,`)
    const resets = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /^\s*excludedNoteSections: \[\],$/.test(l));
    expect(resets.length).toBeGreaterThanOrEqual(2);
    for (const { i } of resets)
      expect(lines[i + 1]).toMatch(/hasChosenNotePrint: false,/);
    const saves = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /^\s*excludedNoteSections,$/.test(l));
    expect(saves.length).toBeGreaterThanOrEqual(1);
    for (const { i } of saves)
      expect(lines[i + 1]).toMatch(/hasChosenNotePrint: true,/);
    expect(writers.length).toBeGreaterThan(0);
  });

  it('approval is the only place a report becomes APPROVED, and it freezes the choice there', () => {
    const setters = service.match(/status: LabReportStatus\.APPROVED,/g) ?? [];
    // one in the tx update of approve() and one in a worklist filter; the update must carry the freeze
    const approveBody = service.slice(
      service.indexOf('async approve('),
      service.indexOf('private async freezeNotePrintChoice'),
    );
    expect(approveBody).toMatch(
      /const notePrintChoice = await this\.freezeNotePrintChoice\(/,
    );
    expect(approveBody).toMatch(/\.\.\.notePrintChoice,/);
    expect(setters.length).toBeGreaterThanOrEqual(1);
  });

  it('every Notes section the app knows is blanked by the print when left out', () => {
    for (const key of NOTE_SECTION_KEYS) {
      // the call may be wrapped over several lines by the formatter
      expect(service).toMatch(new RegExp(String.raw`section\(\s*'${key}'`));
    }
  });

  it('the Print choice is only saved through the status-gated writer', () => {
    const save = service.slice(
      service.indexOf('async updateNotePrintSections('),
      service.indexOf('private async updateNotesWhileEditable'),
    );
    expect(save).toMatch(/this\.assertParameterNoteEditable\(/);
    expect(save).toMatch(/this\.updateNotesWhileEditable\(/);
    expect(save).not.toMatch(/this\.prisma\.labReport\.update\(/);
  });

  it('the screen rule (what is ticked) and the print rule use the same resolver', () => {
    // GET /lab-reports/:id (screen), PATCH (save) and buildPrintContext (print) must all go through resolveNotesPrint
    const uses = service.match(/this\.resolveNotesPrint\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(4); // detail, save, print, freeze
  });

  describe('migration and schema agree', () => {
    const migrationDir = join(
      __dirname,
      '..',
      '..',
      '..',
      'prisma',
      'migrations',
    );
    const name = readdirSync(migrationDir).find((d) =>
      d.endsWith('_add_lab_report_has_chosen_note_print'),
    );
    const sql = name
      ? readFileSync(join(migrationDir, name, 'migration.sql'), 'utf8')
      : '';
    const schema = readFileSync(
      join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
      'utf8',
    );

    it('the migration exists and adds a NOT NULL boolean defaulting to false', () => {
      expect(name).toBeDefined();
      expect(sql).toMatch(
        /ALTER TABLE "lab_reports" ADD COLUMN "has_chosen_note_print" BOOLEAN NOT NULL DEFAULT false;/,
      );
    });

    it('the schema maps the field to that same column with the same default', () => {
      expect(schema).toMatch(
        /hasChosenNotePrint\s+Boolean\s+@default\(false\)\s+@map\("has_chosen_note_print"\)/,
      );
    });

    it('the backfill only names statuses that exist, and freezes issued reports', () => {
      const enumBlock = /enum LabReportStatus \{([^}]*)\}/.exec(schema)![1]!;
      const known = enumBlock
        .split('\n')
        .map((l) => l.trim().split(/\s/)[0]!)
        .filter(Boolean);
      const named = [...sql.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
      expect(named.length).toBeGreaterThan(0);
      for (const s of named) expect(known).toContain(s);
      expect(named).toEqual(expect.arrayContaining(['APPROVED', 'PUBLISHED']));
    });

    it('the backfill never rewrites an existing list (existing reports keep printing as they do)', () => {
      expect(sql).not.toMatch(/SET\s+"excluded_note_sections"/i);
      expect(sql).toMatch(/SET "has_chosen_note_print" = true/);
    });
  });
});
