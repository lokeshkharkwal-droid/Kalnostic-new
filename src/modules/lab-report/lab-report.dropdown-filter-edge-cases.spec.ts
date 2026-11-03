import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { LabReportController } from './lab-report.controller';
import { LabReportNotFoundException } from './exceptions/lab-report.exceptions';
import { ListLabReportsDto } from './dto/list-lab-reports.dto';
import { LabReportCatalogueOptionsQueryDto } from './dto/lab-report-catalogue-options-query.dto';
import {
  NO_MEMBER_MATCHES,
  type MemberEntryMatches,
} from './utils/member-test-match.util';
import type { WorklistBranchScope } from './access/worklist-branch-scope';

/**
 * Edge cases of the dropdown / filter / opening-a-report work (Technician -> Reporting) that the other specs do not
 * pin, written to catch where it could BREAK:
 *   A. what the endpoints accept (query validation, so a bad value is a 400 and never reaches a query);
 *   B. the Lab Test / Lab Panel dropdowns (dedup + paging arithmetic, blank / hostile search, the exact query - so a
 *      department condition can never creep back in by a merge, errors are not swallowed);
 *   C. the panel-member lookups behind the search and the Lab Test filter;
 *   D. the pure `where` the list, the counts and the TAT summary share (combinations, no mutation of inputs, the
 *      unrestricted rule for a user with no department);
 *   E. opening one report (fail closed, same "not found" as a missing one, never reached by save/submit paths);
 *   F. the controller (the by-id read gets the caller; no GET route is shadowed by `GET :id`).
 */

type Where = Prisma.LabReportWhereInput;
const SINGLE: WorklistBranchScope = {
  rules: [{ branchId: 'b1', statuses: 'ALL' }],
};
const TWO_BRANCHES: WorklistBranchScope = {
  rules: [
    { branchId: 'A', statuses: 'ALL' },
    { branchId: 'B', statuses: 'ALL' },
  ],
};
const deps = () => Array(11).fill(undefined) as unknown[];
const makeService = (d: unknown[] = deps()) =>
  new LabReportService(
    ...(d as ConstructorParameters<typeof LabReportService>),
  );
const andOf = (w: Where): Where[] =>
  Array.isArray(w.AND) ? w.AND : w.AND ? [w.AND] : [];
const text = (v: unknown) => JSON.stringify(v);

type BuildListWhere = (
  tenantId: string,
  scope: WorklistBranchScope,
  filters: object,
  scopeIds: string[],
  members?: MemberEntryMatches,
) => Where;
const buildListWhere = (): BuildListWhere => {
  const service = makeService() as unknown as {
    buildListWhere: BuildListWhere;
  };
  return service.buildListWhere.bind(service);
};

const UUID = '3939036f-a21f-42f5-b771-1dfc2151b928';

/* ------------------------------------------------------------------ A */
describe('A. what the endpoints accept (a bad value is a 400 and never reaches a query)', () => {
  const errorsOf = <T extends object>(
    cls: new () => T,
    plain: Record<string, unknown>,
  ) => validateSync(plainToInstance(cls, plain)).map((e) => e.property);

  describe('Lab Test / Lab Panel dropdown query (page, limit, search)', () => {
    it.each([
      [{}],
      [{ page: '1', limit: '100', search: '' }],
      [{ search: 'a'.repeat(255) }],
      [{ search: '  padded  ' }],
      [{ search: '%_\\' }],
    ])('accepts %j', (plain) => {
      expect(errorsOf(LabReportCatalogueOptionsQueryDto, plain)).toEqual([]);
    });

    it.each([
      ['page 0', { page: '0' }, 'page'],
      ['a negative page', { page: '-1' }, 'page'],
      ['a fractional page', { page: '1.5' }, 'page'],
      ['a non-numeric page', { page: 'abc' }, 'page'],
      ['limit 0', { limit: '0' }, 'limit'],
      ['limit 101 (the cap is 100)', { limit: '101' }, 'limit'],
      ['a 256-character search', { search: 'a'.repeat(256) }, 'search'],
      ['search given twice (an array)', { search: ['a', 'b'] }, 'search'],
    ])('refuses %s', (_name, plain, property) => {
      expect(errorsOf(LabReportCatalogueOptionsQueryDto, plain)).toContain(
        property,
      );
    });
  });

  describe('worklist list query (search, ids)', () => {
    it('an empty query is valid', () => {
      expect(errorsOf(ListLabReportsDto, {})).toEqual([]);
    });

    it('search is capped at 50 characters (the frontend box allows the same 50)', () => {
      expect(errorsOf(ListLabReportsDto, { search: 'a'.repeat(50) })).toEqual(
        [],
      );
      expect(errorsOf(ListLabReportsDto, { search: 'a'.repeat(51) })).toContain(
        'search',
      );
    });

    it.each(['branchLabTestId', 'branchLabPanelId', 'departmentId'])(
      '%s must be a UUID: a real one passes, free text does not',
      (field) => {
        expect(errorsOf(ListLabReportsDto, { [field]: UUID })).toEqual([]);
        expect(
          errorsOf(ListLabReportsDto, { [field]: 'not-a-uuid' }),
        ).toContain(field);
        expect(errorsOf(ListLabReportsDto, { [field]: '' })).toContain(field);
      },
    );
  });
});

/* ------------------------------------------------------------------ B */
describe('B. Lab Test / Lab Panel dropdowns', () => {
  type Row = { id: string; name: string; sourceId: string | null };
  type Args = { where: Record<string, unknown> };

  function build(kind: 'test' | 'panel', rows: Row[]) {
    const findMany = jest
      .fn<Promise<unknown[]>, [Args]>()
      .mockResolvedValue(
        rows.map((r) =>
          kind === 'test'
            ? { id: r.id, testName: r.name, sourceLabTestId: r.sourceId }
            : { id: r.id, panelName: r.name, sourceLabPanelId: r.sourceId },
        ),
      );
    const d = deps();
    d[0] =
      kind === 'test'
        ? { branchLabTest: { findMany } }
        : { branchLabPanel: { findMany } };
    const service = makeService(d);
    const options = (q: { search?: string; page?: number; limit?: number }) =>
      kind === 'test'
        ? service.getLabTestOptions('t1', 'b1', q)
        : service.getLabPanelOptions('t1', 'b1', q);
    return {
      findMany,
      options,
      where: () => findMany.mock.calls.at(-1)![0].where,
    };
  }
  const row = (
    id: string,
    name: string,
    sourceId: string | null = null,
  ): Row => ({
    id,
    name,
    sourceId,
  });

  describe.each([['test' as const], ['panel' as const]])(
    'Lab %s dropdown',
    (kind) => {
      const nameKey = kind === 'test' ? 'testName' : 'panelName';

      it('the query is EXACTLY tenant + active branch + active + not deleted - no department, OR or AND key can creep back in', async () => {
        const m = build(kind, [row('1', 'A')]);
        await m.options({});
        expect(m.where()).toEqual({
          tenantId: 't1',
          branchId: 'b1',
          isActive: true,
          deletedAt: null,
        });
        expect(text(m.where())).not.toMatch(/department|"OR"|"AND"/i);
      });

      it('a blank or whitespace-only search is no search at all', async () => {
        for (const search of ['', '   ', '\t\n']) {
          const m = build(kind, [row('1', 'A')]);
          await m.options({ search });
          expect(m.where()).not.toHaveProperty(nameKey);
        }
      });

      it('a search is trimmed first and its wildcards are escaped after, so " a%b " means the literal a%b', async () => {
        const m = build(kind, [row('1', 'A')]);
        await m.options({ search: ' a%b ' });
        expect(m.where()[nameKey]).toEqual({
          contains: 'a\\%b',
          mode: 'insensitive',
        });
      });

      it('a lone backslash and a lone underscore are literal too', async () => {
        for (const [typed, escaped] of [
          ['\\', '\\\\'],
          ['_', '\\_'],
        ] as const) {
          const m = build(kind, [row('1', 'A')]);
          await m.options({ search: typed });
          expect(m.where()[nameKey]).toEqual({
            contains: escaped,
            mode: 'insensitive',
          });
        }
      });

      it('the total counts DISTINCT entries (copies in several price lists once), not rows', async () => {
        const m = build(kind, [
          row('a1', 'Alpha', 's-a'),
          row('a2', 'Alpha', 's-a'),
          row('a3', 'Alpha', 's-a'),
          row('b1', 'Beta'),
          row('c1', 'Gamma', 's-c'),
          row('c2', 'Gamma', 's-c'),
        ]);
        const r = await m.options({});
        expect(r.total).toBe(3);
        expect(r.data.map((o) => o.id)).toEqual(['s-a', 'b1', 's-c']);
      });

      it('two different entries with the same NAME are both listed (the dedup is by master id, not by name)', async () => {
        const m = build(kind, [row('1', 'Same', 's1'), row('2', 'Same', 's2')]);
        const r = await m.options({});
        expect(r.data.map((o) => o.id)).toEqual(['s1', 's2']);
      });

      it('walking every page gives each distinct entry exactly once, in the database order, with no gap and no repeat', async () => {
        const rows = [
          row('1', 'A', 's1'),
          row('2', 'A', 's1'),
          row('3', 'B'),
          row('4', 'C', 's4'),
          row('5', 'D', 's5'),
          row('6', 'D', 's5'),
          row('7', 'E'),
        ];
        const m = build(kind, rows);
        const seen: string[] = [];
        for (let page = 1; page <= 4; page++) {
          const r = await m.options({ page, limit: 2 });
          expect(r.total).toBe(5);
          expect(r.page).toBe(page);
          seen.push(...r.data.map((o) => o.id));
        }
        expect(seen).toEqual(['s1', '3', 's4', 's5', '7']);
        expect(new Set(seen).size).toBe(seen.length);
      });

      it('a page past the end is an empty list with the real total, not an error', async () => {
        const m = build(kind, [row('1', 'A'), row('2', 'B')]);
        const r = await m.options({ page: 50, limit: 10 });
        expect(r.data).toEqual([]);
        expect(r.total).toBe(2);
        expect(r.page).toBe(50);
      });

      it('no entries at all: an empty list and a zero total', async () => {
        const m = build(kind, []);
        const r = await m.options({});
        expect(r.data).toEqual([]);
        expect(r.total).toBe(0);
      });

      it('a limit larger than the list returns everything on page 1', async () => {
        const m = build(kind, [row('1', 'A'), row('2', 'B')]);
        const r = await m.options({ page: 1, limit: 100 });
        expect(r.data).toHaveLength(2);
      });

      it('a database failure is NOT swallowed into an empty dropdown', async () => {
        const m = build(kind, []);
        m.findMany.mockRejectedValueOnce(new Error('db down'));
        await expect(m.options({})).rejects.toThrow('db down');
      });

      it('an entry with an empty name is still listed (never dropped, never crashes)', async () => {
        const m = build(kind, [row('1', '')]);
        const r = await m.options({});
        expect(r.data).toEqual([{ id: '1', name: '' }]);
      });
    },
  );
});

/* ------------------------------------------------------------------ C */
describe('C. the panel-member lookups behind the search and the Lab Test filter', () => {
  type Args = { where: Record<string, unknown> };
  function build(
    reported: string[],
    answers: Partial<Record<'search' | 'testFilter', string[]>> = {},
  ) {
    const labReport = {
      findMany: jest
        .fn<Promise<unknown[]>, [Args & { distinct?: string[] }]>()
        .mockResolvedValue(
          reported.map((id) => ({ memberBranchLabTestId: id })),
        ),
    };
    const kind = (w: Record<string, unknown>) =>
      w.testName ? 'search' : 'testFilter';
    const branchLabTest = {
      findMany: jest.fn<Promise<unknown[]>, [Args]>((a) =>
        Promise.resolve((answers[kind(a.where)] ?? []).map((id) => ({ id }))),
      ),
    };
    const d = deps();
    d[0] = { labReport, branchLabTest };
    const service = makeService(d) as unknown as {
      resolveMemberEntryMatches: (
        t: string,
        s: WorklistBranchScope,
        f: Partial<ListLabReportsDto>,
      ) => Promise<MemberEntryMatches>;
    };
    const resolve = (f: Partial<ListLabReportsDto>) =>
      service.resolveMemberEntryMatches('t1', SINGLE, f);
    const lookups = () =>
      branchLabTest.findMany.mock.calls.map((c) => c[0].where);
    return { resolve, labReport, branchLabTest, lookups };
  }

  it('the Lab Test filter still resolves when NO panel member has a report (only the name search is skipped)', async () => {
    const m = build([], { testFilter: ['e1', 'e2'] });
    const r = await m.resolve({ search: 'cbc', branchLabTestId: UUID });
    expect(r).toEqual({ search: [], testFilter: ['e1', 'e2'] });
    expect(m.lookups()).toHaveLength(1);
  });

  it('search and Lab Test filter together: each is looked up exactly once and they stay separate', async () => {
    const m = build(['m1', 'm2'], { search: ['m1'], testFilter: ['m2'] });
    const r = await m.resolve({ search: 'hb', branchLabTestId: UUID });
    expect(r).toEqual({ search: ['m1'], testFilter: ['m2'] });
    expect(m.lookups()).toHaveLength(2);
    expect(m.labReport.findMany).toHaveBeenCalledTimes(1);
  });

  it('both lookups only see live (not deleted) entries', async () => {
    const m = build(['m1'], { search: ['m1'], testFilter: ['m1'] });
    await m.resolve({ search: 'hb', branchLabTestId: UUID });
    for (const where of m.lookups()) expect(where.deletedAt).toBeNull();
  });

  it('the name search is limited to the member entries that really appear on reports (never the whole catalogue)', async () => {
    const m = build(['m1', 'm2'], { search: ['m1'] });
    await m.resolve({ search: 'hb' });
    expect(m.lookups()[0]!.id).toEqual({ in: ['m1', 'm2'] });
  });

  it('the member entries are read from reports that are live, belong to a panel member, in the caller branches', async () => {
    const m = build(['m1']);
    await m.resolve({ search: 'hb' });
    const call = m.labReport.findMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({
      tenantId: 't1',
      deletedAt: null,
      memberBranchLabTestId: { not: null },
      branchId: 'b1',
    });
    expect(call.distinct).toEqual(['memberBranchLabTestId']);
  });

  it('hostile search text (wildcards, backslash, quotes) is matched literally and never breaks the lookup', async () => {
    const m = build(['m1']);
    await m.resolve({ search: `%_\\'"; DROP TABLE x;--` });
    const search = m.lookups()[0]!.testName as { contains: string };
    expect(search.contains).toBe(`\\%\\_\\\\'"; DROP TABLE x;--`);
  });

  it('a whitespace-only search with a Lab Test filter resolves only the filter', async () => {
    const m = build(['m1'], { testFilter: ['m1'] });
    const r = await m.resolve({ search: '   ', branchLabTestId: UUID });
    expect(r).toEqual({ search: [], testFilter: ['m1'] });
    expect(m.lookups()).toHaveLength(1);
  });

  it('a failing lookup is NOT swallowed into "no member matches" (that would silently hide reports)', async () => {
    const m = build(['m1']);
    m.branchLabTest.findMany.mockRejectedValueOnce(new Error('lookup failed'));
    await expect(m.resolve({ search: 'hb' })).rejects.toThrow('lookup failed');
  });

  it('a very long member list is still ONE lookup (documents that the ids are not chunked)', async () => {
    const many = Array.from({ length: 5000 }, (_, i) => `m${i}`);
    const m = build(many, { search: ['m7'] });
    const r = await m.resolve({ search: 'hb' });
    expect(r.search).toEqual(['m7']);
    expect(m.lookups()).toHaveLength(1);
    expect((m.lookups()[0]!.id as { in: string[] }).in).toHaveLength(5000);
  });
});

/* ------------------------------------------------------------------ D */
describe('D. the shared `where` (list, counts, TAT summary)', () => {
  const MEMBERS: MemberEntryMatches = { search: ['ms1'], testFilter: ['mt1'] };

  it('every condition at once: the branch rule first, one alternative per member condition (Lab Test filter, then search), the department rule last', () => {
    const w = buildListWhere()(
      't1',
      TWO_BRANCHES,
      {
        search: 'lipid',
        branchLabTestId: 'T',
        branchLabPanelId: 'P',
        departmentId: 'D',
        status: 'APPROVED',
      },
      ['d1'],
      MEMBERS,
    );
    const and = andOf(w);
    expect(and).toHaveLength(4);
    expect(text(and[0])).toContain('"A"');
    expect(text(and[0])).toContain('"B"');
    expect(text(and[1])).toContain('mt1');
    expect(text(and[1])).not.toContain('ms1');
    expect(text(and[2])).toContain('ms1');
    expect(text(and[2])).not.toContain('mt1');
    expect(text(and[3])).toContain('d1');
    // the filters that live on the report itself are untouched by the member alternatives
    expect(w.departmentId).toBe('D');
    expect(w.status).toBe('APPROVED');
    expect(w.orderItem?.branchLabPanel).toBeDefined();
  });

  it('a user with NO department is unrestricted: the last clause only carries the per-branch structure (no department test), and every other clause is still there', () => {
    const w = buildListWhere()(
      't1',
      TWO_BRANCHES,
      { search: 'lipid', branchLabTestId: 'T' },
      [],
      MEMBERS,
    );
    const and = andOf(w);
    expect(and).toHaveLength(4);
    expect(text(and.at(-1))).not.toContain('departmentId');
    expect(text(w)).not.toContain('"departmentId":null');
    expect(text(and[1])).toContain('mt1');
    expect(text(and[2])).toContain('ms1');
  });

  it('the member ids are never copied into the department rule (a member is never judged by its panel)', () => {
    const w = buildListWhere()('t1', SINGLE, { search: 'x' }, ['d1'], MEMBERS);
    const departmentRule = andOf(w).at(-1)!;
    expect(text(departmentRule)).not.toContain('ms1');
    expect(text(departmentRule)).not.toContain('branchLabPanel');
  });

  it('the inputs are never changed (frozen filters, member ids and department ids do not throw)', () => {
    const freeze = <T extends object>(o: T): T => {
      Object.values(o).forEach((v) => {
        if (v && typeof v === 'object') freeze(v as object);
      });
      return Object.freeze(o);
    };
    const filters = freeze({ search: 'x', branchLabTestId: 'T' });
    const members = freeze({ search: ['ms1'], testFilter: ['mt1'] });
    const scopeIds = freeze(['d1', 'd2']);
    const scope = freeze({
      rules: [{ branchId: 'A', statuses: 'ALL' as const }],
    });
    expect(() =>
      buildListWhere()('t1', scope, filters, scopeIds, members),
    ).not.toThrow();
  });

  it('it is deterministic: the same input gives the same query twice, and the default member object stays empty', () => {
    const build = buildListWhere();
    const a = build('t1', SINGLE, { search: 'x', branchLabTestId: 'T' }, [
      'd1',
    ]);
    const b = build('t1', SINGLE, { search: 'x', branchLabTestId: 'T' }, [
      'd1',
    ]);
    expect(a).toEqual(b);
    expect(NO_MEMBER_MATCHES).toEqual({ search: [], testFilter: [] });
  });

  it('a Lab Test filter and a Lab Panel filter together do not overwrite each other', () => {
    const w = buildListWhere()(
      't1',
      SINGLE,
      { branchLabTestId: 'T', branchLabPanelId: 'P' },
      [],
      { search: [], testFilter: ['mt1'] },
    );
    expect(w.orderItem?.branchLabPanel).toEqual({
      OR: [{ id: 'P' }, { sourceLabPanelId: 'P' }],
    });
    expect(text(andOf(w))).toContain('mt1');
  });

  it('search text with wildcards is escaped on the order-line side too (not only for member names)', () => {
    const w = buildListWhere()('t1', SINGLE, { search: '50%_' }, [], MEMBERS);
    expect(text(w)).toContain('50\\\\%\\\\_');
    expect(text(w)).not.toContain('"50%_"');
  });
});

/* ------------------------------------------------------------------ E */
describe('E. opening one report (findByIdForViewer)', () => {
  function build(
    detail: { departmentId?: string | null } | 'missing',
    scopeIds: string[] | Error,
  ) {
    const resolveDepartmentIds =
      scopeIds instanceof Error
        ? jest.fn().mockRejectedValue(scopeIds)
        : jest.fn().mockResolvedValue(scopeIds);
    const service = makeService();
    Object.assign(service, { userDepartmentScope: { resolveDepartmentIds } });
    const spy = jest.spyOn(service, 'findByIdForApi');
    if (detail === 'missing')
      spy.mockRejectedValue(new LabReportNotFoundException('r1'));
    else spy.mockResolvedValue({ id: 'r1', ...detail } as never);
    return { service, resolveDepartmentIds };
  }
  const open = (m: ReturnType<typeof build>) =>
    m.service.findByIdForViewer('r1', 't1', 'b1', 'p1');

  it('a failing department lookup is NOT an "allow": the error comes out and no detail is returned (fails closed)', async () => {
    const m = build({ departmentId: 'bio' }, new Error('scope lookup failed'));
    await expect(open(m)).rejects.toThrow('scope lookup failed');
  });

  it('a detail with no department field at all is hidden from a user who has departments, open to one who has none', async () => {
    await expect(open(build({}, ['bio']))).rejects.toBeInstanceOf(
      LabReportNotFoundException,
    );
    await expect(open(build({}, []))).resolves.toBeDefined();
  });

  it('department ids are compared exactly (a different case or a trailing space is another department)', async () => {
    for (const stamped of ['BIO', 'bio ', ' bio']) {
      await expect(
        open(build({ departmentId: stamped }, ['bio'])),
      ).rejects.toBeInstanceOf(LabReportNotFoundException);
    }
  });

  it('an empty-string department is a department, not "none": hidden from a user who has other departments', async () => {
    await expect(
      open(build({ departmentId: '' }, ['bio'])),
    ).rejects.toBeInstanceOf(LabReportNotFoundException);
  });

  it('a duplicated department in the user scope changes nothing', async () => {
    await expect(
      open(build({ departmentId: 'bio' }, ['bio', 'bio', 'rad'])),
    ).resolves.toBeDefined();
  });

  it('a hidden report is the SAME error as a missing one (same class, same status, same body)', async () => {
    const hidden = await open(build({ departmentId: 'rad' }, ['bio'])).catch(
      (e: unknown) => e,
    );
    const missing = await open(build('missing', ['bio'])).catch(
      (e: unknown) => e,
    );
    expect(hidden).toBeInstanceOf(LabReportNotFoundException);
    expect(missing).toBeInstanceOf(LabReportNotFoundException);
    const h = hidden as LabReportNotFoundException;
    const m = missing as LabReportNotFoundException;
    expect(h.getStatus()).toBe(m.getStatus());
    expect(text(h.getResponse())).toBe(text(m.getResponse()));
  });

  it('only the controller read route uses the check - never a save / submit path (those must not fail after the write)', () => {
    const root = join(__dirname, '..');
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
          if (readFileSync(p, 'utf8').includes('findByIdForViewer'))
            users.push(name);
        }
      }
    };
    walk(root);
    expect(users.sort()).toEqual([
      'lab-report.controller.ts',
      'lab-report.service.ts',
    ]);
  });
});

/* ------------------------------------------------------------------ F */
describe('F. the controller', () => {
  it('GET :id gives the caller to the department-checked read (tenant, active branch, person)', async () => {
    const labReportService = {
      findByIdForViewer: jest.fn().mockResolvedValue({ id: 'r1' }),
    };
    const controller = new LabReportController(
      undefined as never,
      labReportService as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    await controller.findOne(
      't1',
      { profileKey: 'lab_technician', branchId: 'b1' },
      'person-9',
      'r1',
    );
    expect(labReportService.findByIdForViewer).toHaveBeenCalledWith(
      'r1',
      't1',
      'b1',
      'person-9',
    );
  });

  it('no GET route is shadowed by an earlier GET route (a static path declared after `:id` would answer as a report id)', () => {
    const proto = LabReportController.prototype as unknown as Record<
      string,
      unknown
    >;
    const gets: Array<{ handler: string; path: string }> = [];
    for (const handler of Object.getOwnPropertyNames(proto)) {
      const fn = proto[handler];
      if (typeof fn !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as
        | RequestMethod
        | undefined;
      if (method !== RequestMethod.GET) continue;
      const path = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
      gets.push({ handler, path: (path ?? '/').replace(/^\/+/, '') });
    }
    expect(gets.length).toBeGreaterThan(10);

    const segs = (p: string) => (p === '' ? [] : p.split('/'));
    const shadows = (earlier: string, later: string): boolean => {
      const e = segs(earlier);
      const l = segs(later);
      if (e.length !== l.length) return false;
      return e.every(
        (seg, i) =>
          seg.startsWith(':') || (seg === l[i] && !l[i].startsWith(':')),
      );
    };
    const problems: string[] = [];
    gets.forEach((later, i) => {
      gets.slice(0, i).forEach((earlier) => {
        if (shadows(earlier.path, later.path))
          problems.push(
            `${later.handler} (${later.path}) is shadowed by ${earlier.handler} (${earlier.path})`,
          );
      });
    });
    expect(problems).toEqual([]);

    // and the two dropdowns specifically sit before `:id`
    const index = (p: string) => gets.findIndex((g) => g.path === p);
    expect(index('lab-test-options')).toBeGreaterThanOrEqual(0);
    expect(index('lab-test-options')).toBeLessThan(index(':id'));
    expect(index('lab-panel-options')).toBeLessThan(index(':id'));
  });
});
