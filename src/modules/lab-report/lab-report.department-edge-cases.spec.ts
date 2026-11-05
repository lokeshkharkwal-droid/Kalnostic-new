import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { LabReportStatus, OrderStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { toWorklistRow } from './entities/lab-report.entity';
import type {
  LabReportListRow,
  LabReportWorklistRow,
} from './entities/lab-report.entity';
import type { WorklistBranchScope } from './access/worklist-branch-scope';
import { OrderSampleService } from '../accession/accession-sample.service';

/**
 * Edge cases of the Option 2 department rule - the places it could break:
 *  1. the whole worklist query against an exhaustive oracle (branch x status x department x user);
 *  2. the Department filter combined with the visibility scope;
 *  3. list, counts and TAT summary all carrying the same clause, and the clause surviving the other
 *     places that assign `where.AND`;
 *  4. FAILING CLOSED when the user's departments cannot be resolved;
 *  5. mapper robustness (missing / deleted department, the by-id detail);
 *  6. nothing but `createReportForAcceptedItem` ever writes `LabReport.departmentId`, and the real transfer
 *     functions never put it in their report writes.
 */

type Where = Record<string, unknown>;
type Row = Record<string, unknown>;

const BIO = 'BIOCHEMISTRY';
const PATH = 'PATHOLOGY';

const planner = Object.create(LabReportService.prototype) as unknown as {
  buildListWhere: (
    tenantId: string,
    scope: WorklistBranchScope,
    filters: object,
    scopeIds: string[],
  ) => Where;
};

/** Evaluates exactly the clause shapes a filter-free / department-filter request produces; throws on anything else. */
function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') {
      return (Array.isArray(cond) ? cond : [cond]).every((c) =>
        matches(row, c as Where),
      );
    }
    if (key === 'OR') return (cond as Where[]).some((c) => matches(row, c));
    if (
      cond !== null &&
      typeof cond === 'object' &&
      Object.keys(cond).length === 0
    ) {
      return true;
    }
    if (!(key in row)) throw new Error(`unmodelled filter key: ${key}`);
    const value = row[key];
    if (cond === null) return value === null;
    if (typeof cond !== 'object') return value === cond;
    const op = cond as Record<string, unknown>;
    if ('in' in op) return (op.in as unknown[]).includes(value);
    if ('not' in op) return value !== op.not;
    throw new Error(`unmodelled filter operator on ${key}`);
  });
}

const departmentClause = (ids: string[]): Where => ({
  OR: [{ departmentId: null }, { departmentId: { in: ids } }],
});

function hasDepartmentClause(where: Where, ids: string[]): boolean {
  const and = where.AND;
  const list = Array.isArray(and) ? and : and ? [and] : [];
  const wanted = JSON.stringify(departmentClause(ids));
  return list.some((c) => JSON.stringify(c) === wanted);
}

// ─── 1 + 2. exhaustive oracle ────────────────────────────────────────────────────────────────────────────

const BRANCHES = ['A', 'B', 'C'];
const STATUSES = [
  LabReportStatus.PENDING,
  LabReportStatus.SAVED,
  LabReportStatus.APPROVED,
];
const DEPARTMENTS: Array<string | null> = [null, BIO, PATH];
const USERS: string[][] = [[], [BIO], [PATH], [BIO, PATH], ['OTHER']];
const SCOPES: Record<string, WorklistBranchScope> = {
  'one branch, every status': { rules: [{ branchId: 'A', statuses: 'ALL' }] },
  'two branches, B limited to Saved': {
    rules: [
      { branchId: 'A', statuses: 'ALL' },
      { branchId: 'B', statuses: new Set([LabReportStatus.SAVED]) },
    ],
  },
  'one branch limited to Pending + Saved': {
    rules: [
      {
        branchId: 'B',
        statuses: new Set([LabReportStatus.PENDING, LabReportStatus.SAVED]),
      },
    ],
  },
  'a branch that grants no status at all': {
    rules: [{ branchId: 'A', statuses: new Set() }],
  },
};

function everyRow(): Row[] {
  const rows: Row[] = [];
  for (const branchId of BRANCHES) {
    for (const status of STATUSES) {
      for (const departmentId of DEPARTMENTS) {
        rows.push({
          tenantId: 't1',
          deletedAt: null,
          branchId,
          status,
          departmentId,
          orderItem: null,
        });
      }
    }
  }
  return rows;
}

function oracle(
  row: Row,
  scope: WorklistBranchScope,
  users: string[],
  departmentFilter?: string,
): boolean {
  const branchOk = scope.rules.some(
    (r) =>
      r.branchId === row.branchId &&
      (r.statuses === 'ALL' || r.statuses.has(row.status as LabReportStatus)),
  );
  const dep = row.departmentId as string | null;
  const departmentOk =
    users.length === 0 || dep === null || users.includes(dep);
  const filterOk = departmentFilter === undefined || dep === departmentFilter;
  return branchOk && departmentOk && filterOk;
}

describe('the whole worklist query agrees with a plain-language oracle', () => {
  it("for every branch x status x saved department x user x branch scope (a report is listed iff its branch+status are granted AND its saved department is NULL or the user's, or the user has none)", () => {
    const mismatches: string[] = [];
    for (const [scopeName, scope] of Object.entries(SCOPES)) {
      for (const users of USERS) {
        const where = planner.buildListWhere('t1', scope, {}, users);
        for (const row of everyRow()) {
          if (matches(row, where) !== oracle(row, scope, users)) {
            mismatches.push(
              `${scopeName} | users=[${users.join(',')}] | ${String(row.branchId)}/${String(row.status)}/${String(row.departmentId)}`,
            );
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('the Department filter never widens access and stays strict equality (NULL is not a match for a chosen department)', () => {
    const mismatches: string[] = [];
    const scope = SCOPES['two branches, B limited to Saved']!;
    for (const users of USERS) {
      for (const filter of [BIO, PATH, 'OTHER']) {
        const where = planner.buildListWhere(
          't1',
          scope,
          { departmentId: filter },
          users,
        );
        for (const row of everyRow()) {
          if (matches(row, where) !== oracle(row, scope, users, filter)) {
            mismatches.push(
              `users=[${users.join(',')}] filter=${filter} | ${String(row.branchId)}/${String(row.status)}/${String(row.departmentId)}`,
            );
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('a user in X who filters for Y gets nothing, and a user in X who filters for X does not get NULL-department reports', () => {
    const scope = SCOPES['one branch, every status']!;
    const row = (departmentId: string | null): Row => ({
      tenantId: 't1',
      deletedAt: null,
      branchId: 'A',
      status: LabReportStatus.PENDING,
      departmentId,
      orderItem: null,
    });
    const forY = planner.buildListWhere('t1', scope, { departmentId: PATH }, [
      BIO,
    ]);
    expect(matches(row(PATH), forY)).toBe(false);
    const forX = planner.buildListWhere('t1', scope, { departmentId: BIO }, [
      BIO,
    ]);
    expect(matches(row(BIO), forX)).toBe(true);
    expect(matches(row(null), forX)).toBe(false);
  });

  it('with a user that has no department the filter alone decides, and no filter lists every department', () => {
    const scope = SCOPES['one branch, every status']!;
    const unfiltered = planner.buildListWhere('t1', scope, {}, []);
    const filtered = planner.buildListWhere(
      't1',
      scope,
      { departmentId: BIO },
      [],
    );
    const rows = everyRow().filter((r) => r.branchId === 'A');
    expect(rows.filter((r) => matches(r, unfiltered))).toHaveLength(
      rows.length,
    );
    expect(
      rows
        .filter((r) => matches(r, filtered))
        .every((r) => r.departmentId === BIO),
    ).toBe(true);
  });
});

describe('scope edge values', () => {
  const scope: WorklistBranchScope = {
    rules: [{ branchId: 'A', statuses: 'ALL' }],
  };
  const row = (departmentId: string | null): Row => ({
    tenantId: 't1',
    deletedAt: null,
    branchId: 'A',
    status: LabReportStatus.PENDING,
    departmentId,
    orderItem: null,
  });

  it('duplicate department ids in the scope are harmless', () => {
    const where = planner.buildListWhere('t1', scope, {}, [BIO, BIO, BIO]);
    expect(matches(row(BIO), where)).toBe(true);
    expect(matches(row(PATH), where)).toBe(false);
  });

  it('a department id of a deleted / unknown department only matches reports carrying exactly that id', () => {
    const where = planner.buildListWhere('t1', scope, {}, ['gone-dept']);
    expect(matches(row('gone-dept'), where)).toBe(true);
    expect(matches(row(BIO), where)).toBe(false);
    expect(matches(row(null), where)).toBe(true); // NULL stays unrestricted
  });

  it('ids are compared exactly: a different case or a stray space is a different department', () => {
    const where = planner.buildListWhere('t1', scope, {}, [BIO]);
    expect(matches(row('biochemistry'), where)).toBe(false);
    expect(matches(row(`${BIO} `), where)).toBe(false);
    expect(matches(row(''), where)).toBe(false);
  });

  it('an empty-string id in the scope does not turn into "unrestricted" and does not match NULL reports as a department', () => {
    const where = planner.buildListWhere('t1', scope, {}, ['']);
    expect(where.AND).toBeDefined();
    expect(matches(row(BIO), where)).toBe(false);
    expect(matches(row(''), where)).toBe(true);
    expect(matches(row(null), where)).toBe(true);
  });

  it('a very large scope still produces ONE clause', () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `dept-${i}`);
    const where = planner.buildListWhere('t1', scope, {}, ids);
    expect((where.AND as Where[]).length).toBe(1);
    expect(matches(row('dept-4999'), where)).toBe(true);
    expect(matches(row('dept-5000'), where)).toBe(false);
  });
});

// ─── 3 + 4. list, counts and TAT summary; failing closed ─────────────────────────────────────────────────

interface Wired {
  svc: {
    findAll: (
      tenantId: string,
      scope: WorklistBranchScope,
      filters: object,
      personId: string,
    ) => Promise<unknown>;
    getCounts: (
      tenantId: string,
      scope: WorklistBranchScope,
      filters: object,
      personId: string,
    ) => Promise<unknown>;
    getTatSummary: (
      tenantId: string,
      scope: WorklistBranchScope,
      filters: object,
      personId: string,
    ) => Promise<unknown>;
  };
  resolve: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
  summarize: jest.Mock;
}

const ATTACHERS = [
  'attachBranchNames',
  'attachDepartmentNames',
  'attachMemberTestNames',
  'attachResultTypes',
  'attachSampleStatuses',
  'attachDisplayBranch',
  'attachReturnedByReceiver',
  'attachAccessMode',
  'attachLockedByNames',
  'attachMultiStepProcess',
];

function wired(resolve: jest.Mock): Wired {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const summarize = jest.fn().mockResolvedValue({ total: 0 });
  const svc = Object.create(LabReportService.prototype) as Record<
    string,
    unknown
  >;
  svc.prisma = { labReport: { findMany, count } };
  svc.userDepartmentScope = { resolveDepartmentIds: resolve };
  svc.tatService = { summarize };
  for (const name of ATTACHERS) {
    svc[name] = jest.fn((...args: unknown[]) =>
      Promise.resolve(args[args.length - 1]),
    );
  }
  return {
    svc: svc as unknown as Wired['svc'],
    resolve,
    findMany,
    count,
    summarize,
  };
}

const firstArg = <T>(m: jest.Mock, call = 0): T =>
  (m.mock.calls[call] as unknown[])[0] as T;

const TWO_BRANCHES: WorklistBranchScope = {
  rules: [
    { branchId: 'A', statuses: 'ALL' },
    { branchId: 'B', statuses: new Set([LabReportStatus.SAVED]) },
  ],
};

describe('list, counts and TAT summary all carry the same department clause', () => {
  it("findAll resolves the CALLER's departments and queries with the clause", async () => {
    const w = wired(jest.fn().mockResolvedValue([BIO]));
    await w.svc.findAll('t1', TWO_BRANCHES, {}, 'person-1');
    expect(w.resolve).toHaveBeenCalledWith('t1', 'person-1');
    const where = firstArg<{ where: Where }>(w.findMany).where;
    expect(hasDepartmentClause(where, [BIO])).toBe(true);
    // the branch rules are still there too (the clause was appended, not assigned over them)
    expect(JSON.stringify(where.AND)).toContain('"branchId":"B"');
  });

  it('getCounts: EVERY count (each status, all, in-house, outsource) carries the clause', async () => {
    const w = wired(jest.fn().mockResolvedValue([BIO, PATH]));
    await w.svc.getCounts('t1', TWO_BRANCHES, {}, 'person-1');
    expect(w.count.mock.calls.length).toBe(
      Object.values(LabReportStatus).length + 3,
    );
    for (let i = 0; i < w.count.mock.calls.length; i++) {
      const where = firstArg<{ where: Where }>(w.count, i).where;
      expect(hasDepartmentClause(where, [BIO, PATH])).toBe(true);
    }
  });

  it('getTatSummary keeps the clause AND adds the cancelled-order exclusion after it (nothing overwrites anything)', async () => {
    const w = wired(jest.fn().mockResolvedValue([BIO]));
    await w.svc.getTatSummary('t1', TWO_BRANCHES, {}, 'person-1');
    const where = firstArg<Where>(w.summarize);
    const and = where.AND as Where[];
    expect(and).toHaveLength(3); // branch rules, department, not-cancelled
    expect(and[1]).toEqual(departmentClause([BIO]));
    expect(and[2]).toEqual({
      orderItem: { order: { status: { not: OrderStatus.CANCELLED } } },
    });
    expect(where.status).toBe(LabReportStatus.APPROVED);
  });

  it('a user with no department gets no department clause from any of the three, and the other clauses survive', async () => {
    const w = wired(jest.fn().mockResolvedValue([]));
    await w.svc.findAll('t1', TWO_BRANCHES, {}, 'p');
    await w.svc.getCounts('t1', TWO_BRANCHES, {}, 'p');
    await w.svc.getTatSummary('t1', TWO_BRANCHES, {}, 'p');
    expect(
      JSON.stringify(firstArg<{ where: Where }>(w.findMany).where),
    ).not.toContain('departmentId');
    expect(
      JSON.stringify(firstArg<{ where: Where }>(w.count).where),
    ).not.toContain('departmentId');
    const tat = firstArg<Where>(w.summarize).AND as Where[];
    expect(tat).toHaveLength(2); // branch rules + not-cancelled only
  });

  it('a single branch scope (branchId on the query itself, no AND) still gets the clause as the first AND entry', async () => {
    const w = wired(jest.fn().mockResolvedValue([BIO]));
    await w.svc.findAll(
      't1',
      { rules: [{ branchId: 'A', statuses: 'ALL' }] },
      {},
      'p',
    );
    const where = firstArg<{ where: Where }>(w.findMany).where;
    expect(where.branchId).toBe('A');
    expect(where.AND).toEqual([departmentClause([BIO])]);
  });
});

describe('FAILING CLOSED: an unresolved department scope never turns into "see everything"', () => {
  const run = (resolve: jest.Mock) => {
    const w = wired(resolve);
    return {
      w,
      calls: {
        findAll: () => w.svc.findAll('t1', TWO_BRANCHES, {}, 'p'),
        getCounts: () => w.svc.getCounts('t1', TWO_BRANCHES, {}, 'p'),
        getTatSummary: () => w.svc.getTatSummary('t1', TWO_BRANCHES, {}, 'p'),
      },
    };
  };

  for (const name of ['findAll', 'getCounts', 'getTatSummary'] as const) {
    it(`${name}: when the department lookup FAILS the request fails and no report is queried`, async () => {
      const { w, calls } = run(
        jest.fn().mockRejectedValue(new Error('db down')),
      );
      await expect(calls[name]()).rejects.toThrow('db down');
      expect(w.findMany).not.toHaveBeenCalled();
      expect(w.count).not.toHaveBeenCalled();
      expect(w.summarize).not.toHaveBeenCalled();
    });

    it(`${name}: when the department lookup returns nothing usable (undefined) the request fails and no report is queried`, async () => {
      const { w, calls } = run(jest.fn().mockResolvedValue(undefined));
      await expect(calls[name]()).rejects.toThrow();
      expect(w.findMany).not.toHaveBeenCalled();
      expect(w.count).not.toHaveBeenCalled();
      expect(w.summarize).not.toHaveBeenCalled();
    });
  }
});

// ─── 5. mapper robustness ────────────────────────────────────────────────────────────────────────────────

function listRow(over: Row): LabReportListRow {
  return {
    id: 'r1',
    status: LabReportStatus.PENDING,
    isUrgent: false,
    isOutsourced: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    isLocked: false,
    lockNotes: null,
    lockedAt: null,
    lockedBy: null,
    branchId: 'B',
    departmentId: null,
    labTestId: 'B-master-copy',
    memberBranchLabTestId: null,
    orderItemId: 'oi1',
    performingBranchLabTestId: 'entry-B',
    performingEntry: { departmentId: PATH },
    orderItem: null,
    ...over,
  } as unknown as LabReportListRow;
}

describe('mappers: missing, deleted and unusual department values', () => {
  it('a row whose department field is missing entirely maps to NULL (never to the holder entry department)', () => {
    const row = listRow({});
    delete (row as unknown as Row).departmentId;
    expect(toWorklistRow(row).departmentId).toBeNull();
  });

  it('a transferred report with no holder entry loaded (performingEntry null or missing) still shows the saved department', () => {
    expect(
      toWorklistRow(listRow({ departmentId: BIO, performingEntry: null }))
        .departmentId,
    ).toBe(BIO);
    const row = listRow({ departmentId: BIO });
    delete (row as unknown as Row).performingEntry;
    expect(toWorklistRow(row).departmentId).toBe(BIO);
  });

  describe('attachDepartmentNames', () => {
    const attach = (
      rows: LabReportWorklistRow[],
      found: Array<{ id: string; name: string }>,
    ) => {
      const findMany = jest.fn().mockResolvedValue(found);
      const svc = Object.create(LabReportService.prototype) as unknown as {
        prisma: unknown;
        attachDepartmentNames: (
          tenantId: string,
          rows: LabReportWorklistRow[],
        ) => Promise<LabReportWorklistRow[]>;
      };
      svc.prisma = { department: { findMany } };
      return {
        svc,
        findMany,
        run: () => svc.attachDepartmentNames('t1', rows),
      };
    };
    const mapped = (d: string | null) =>
      toWorklistRow(listRow({ departmentId: d }));

    it('resolves the name of a live department', async () => {
      const a = attach([mapped(BIO)], [{ id: BIO, name: 'Biochemistry' }]);
      const [out] = await a.run();
      expect(out!.departmentId).toBe(BIO);
      expect(out!.department).toEqual({ id: BIO, name: 'Biochemistry' });
    });

    it('a DELETED department keeps the id (the report stays restricted to it) but has no name', async () => {
      const a = attach([mapped('gone-dept')], []);
      const [out] = await a.run();
      expect(out!.departmentId).toBe('gone-dept');
      expect(out!.department).toBeNull();
    });

    it('NULL-department rows trigger no department lookup at all', async () => {
      const a = attach([mapped(null), mapped(null)], []);
      const out = await a.run();
      expect(a.findMany).not.toHaveBeenCalled();
      expect(
        out.every((r) => r.departmentId === null && r.department === null),
      ).toBe(true);
    });

    it('looks the names up once per distinct id', async () => {
      const a = attach(
        [mapped(BIO), mapped(BIO), mapped(PATH), mapped(null)],
        [
          { id: BIO, name: 'Biochemistry' },
          { id: PATH, name: 'Pathology' },
        ],
      );
      await a.run();
      const where = firstArg<{ where: { id: { in: string[] } } }>(
        a.findMany,
      ).where;
      expect([...where.id.in].sort()).toEqual([BIO, PATH].sort());
    });
  });

  describe('the by-id detail (GET /lab-reports/:id) shows the same saved department', () => {
    it('for a transferred report whose holder entry says another department', async () => {
      const svc = Object.create(LabReportService.prototype) as Record<
        string,
        unknown
      >;
      const detail = {
        ...listRow({
          departmentId: BIO,
          performingEntry: { departmentId: PATH },
        }),
        resultValues: [],
        notes: [],
        attachments: [],
        multiStepProcess: null,
        contentSections: {},
        overallResults: [],
        parameterNotes: [],
        resultParams: [],
      };
      svc.findById = jest.fn().mockResolvedValue(detail);
      for (const name of [
        'attachSampleStatuses',
        'attachBranchNames',
        'attachDepartmentNames',
        'attachMemberTestNames',
        'attachResultTypes',
        'attachMultiStepProcess',
        'attachLockedByNames',
        'attachAnalyzerNames',
      ]) {
        svc[name] = jest.fn((...args: unknown[]) =>
          Promise.resolve(args[args.length - 1]),
        );
      }
      svc.resolveNotesPrint = jest.fn().mockResolvedValue({});
      const out = await (
        svc as unknown as {
          findByIdForApi: (
            id: string,
            tenantId: string,
            branchId: string | null,
          ) => Promise<{ departmentId: string | null }>;
        }
      ).findByIdForApi('r1', 't1', 'B');
      expect(out.departmentId).toBe(BIO);
    });
  });
});

// ─── 6. nothing but createOne writes the department ──────────────────────────────────────────────────────

const SRC_ROOT = path.resolve(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

interface WriteSite {
  file: string;
  method: string;
  keys: string[];
  unresolved: boolean;
  enclosing: string[];
}

function findInit(id: ts.Identifier): ts.Expression | undefined {
  let node: ts.Node | undefined = id.parent;
  while (node) {
    const statements = (node as { statements?: ts.NodeArray<ts.Statement> })
      .statements;
    if (statements) {
      for (const s of statements) {
        if (!ts.isVariableStatement(s)) continue;
        for (const d of s.declarationList.declarations) {
          if (
            ts.isIdentifier(d.name) &&
            d.name.text === id.text &&
            d.initializer
          ) {
            return d.initializer;
          }
        }
      }
    }
    node = node.parent;
  }
  return undefined;
}

function keysOf(
  node: ts.Expression | undefined,
  sf: ts.SourceFile,
  depth = 0,
): { keys: string[]; unresolved: boolean } {
  if (!node) return { keys: [], unresolved: false };
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return keysOf(node.expression, sf, depth);
  }
  if (ts.isConditionalExpression(node)) {
    const a = keysOf(node.whenTrue, sf, depth);
    const b = keysOf(node.whenFalse, sf, depth);
    return {
      keys: [...a.keys, ...b.keys],
      unresolved: a.unresolved || b.unresolved,
    };
  }
  if (ts.isIdentifier(node)) {
    const init = depth < 3 ? findInit(node) : undefined;
    return init ? keysOf(init, sf, depth + 1) : { keys: [], unresolved: true };
  }
  if (!ts.isObjectLiteralExpression(node))
    return { keys: [], unresolved: true };
  const keys: string[] = [];
  let unresolved = false;
  for (const p of node.properties) {
    if (ts.isSpreadAssignment(p)) {
      const s = keysOf(p.expression, sf, depth + 1);
      keys.push(...s.keys);
      unresolved = unresolved || s.unresolved;
    } else if (p.name) {
      keys.push(p.name.getText(sf));
    }
  }
  return { keys, unresolved };
}

const WRITE_METHODS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
]);

function labReportWriteSites(): { sites: WriteSite[]; rawSql: string[] } {
  const sites: WriteSite[] = [];
  const rawSql: string[] = [];
  for (const file of sourceFiles(SRC_ROOT)) {
    const text = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const rel = path.relative(SRC_ROOT, file).replace(/\\/g, '/');
    const visit = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        WRITE_METHODS.has(n.expression.name.text) &&
        ts.isPropertyAccessExpression(n.expression.expression) &&
        n.expression.expression.name.text === 'labReport'
      ) {
        const arg = n.arguments[0];
        let keys: string[] = [];
        let unresolved = false;
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const part of n.expression.name.text === 'upsert'
            ? ['create', 'update']
            : ['data']) {
            const prop = arg.properties.find(
              (p) => p.name && p.name.getText(sf) === part,
            );
            if (!prop) continue;
            // `data: { ... }`, `data: someVar` and the shorthand `{ where, data }` are all resolved
            // from the enclosing scope when they name a variable
            const value = ts.isShorthandPropertyAssignment(prop)
              ? prop.name
              : ts.isPropertyAssignment(prop)
                ? prop.initializer
                : undefined;
            const resolved = keysOf(value, sf);
            keys = keys.concat(resolved.keys);
            unresolved = unresolved || resolved.unresolved;
          }
        } else {
          unresolved = true;
        }
        const enclosing: string[] = [];
        for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
          if (ts.isMethodDeclaration(p) && p.name)
            enclosing.push(p.name.getText(sf));
          if (
            ts.isVariableDeclaration(p) &&
            ts.isIdentifier(p.name) &&
            p.initializer &&
            (ts.isArrowFunction(p.initializer) ||
              ts.isFunctionExpression(p.initializer))
          ) {
            enclosing.push(p.name.text);
          }
        }
        sites.push({
          file: rel,
          method: n.expression.name.text,
          keys,
          unresolved,
          enclosing,
        });
      }
      const nodeText =
        (ts.isTaggedTemplateExpression(n) &&
          /\$(query|execute)Raw/.test(n.tag.getText(sf))) ||
        (ts.isCallExpression(n) &&
          /\$(query|execute)Raw(Unsafe)?$/.test(n.expression.getText(sf)))
          ? n.getText(sf)
          : '';
      if (
        nodeText &&
        /lab_reports/i.test(nodeText) &&
        /\b(insert|update|delete)\b[^;]*lab_reports|lab_reports[^;]*\bset\b/i.test(
          nodeText.replace(/FOR UPDATE/gi, ''),
        )
      ) {
        rawSql.push(`${rel}: ${nodeText.slice(0, 80)}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { sites, rawSql };
}

describe('GUARD: the saved report department is written in exactly one place', () => {
  const { sites, rawSql } = labReportWriteSites();
  const writesDepartment = (s: WriteSite) =>
    s.keys.some((k) => k === 'departmentId');

  it('found the report writes at all (the scan is not silently empty)', () => {
    expect(sites.length).toBeGreaterThan(15);
  });

  it('exactly ONE report write sets departmentId: the create inside createReportForAcceptedItem', () => {
    const writers = sites.filter(writesDepartment);
    expect(writers).toHaveLength(1);
    expect(writers[0]!.file).toBe('modules/lab-report/lab-report.service.ts');
    expect(writers[0]!.method).toBe('create');
    expect(writers[0]!.enclosing).toContain('createReportForAcceptedItem');
  });

  it('that create is the ONLY place a report is created (no second creation road, no upsert, no createMany)', () => {
    expect(sites.filter((s) => s.method === 'create')).toHaveLength(1);
    expect(
      sites.filter((s) =>
        ['upsert', 'createMany', 'createManyAndReturn'].includes(s.method),
      ),
    ).toEqual([]);
  });

  it('transfer, return, recall, retarget and referral writes are all resolvable and none carries departmentId', () => {
    const transferFiles = ['modules/accession/accession-sample.service.ts'];
    const inTransfer = sites.filter((s) => transferFiles.includes(s.file));
    expect(inTransfer.length).toBeGreaterThan(0);
    expect(inTransfer.some(writesDepartment)).toBe(false);
    expect(inTransfer.some((s) => s.unresolved)).toBe(false);
    const inService = sites.filter(
      (s) =>
        s.file === 'modules/lab-report/lab-report.service.ts' &&
        [
          'rehomeReportsForAcceptedItem',
          'moveReportsToBranch',
          'markReportsReferralForSample',
          'resetReportsForReturn',
        ].some((m) => s.enclosing.includes(m)),
    );
    expect(inService.length).toBeGreaterThanOrEqual(4);
    expect(inService.some(writesDepartment)).toBe(false);
    expect(inService.some((s) => s.unresolved)).toBe(false);
  });

  it('any write whose data cannot be resolved statically is a KNOWN one (new ones must be reviewed)', () => {
    const known = (s: WriteSite): boolean =>
      s.file === 'modules/lab-report/nabl-tat-cron.service.ts' || // TAT stopwatch patch
      s.enclosing.includes('updateNotesWhileEditable') || // content sections / note-print only
      s.enclosing.includes('approve'); // spreads resolveSignatoryColumns + freezeNotePrintChoice
    const unknown = sites.filter((s) => s.unresolved && !known(s));
    expect(
      unknown.map((s) => `${s.file} ${s.method} in ${s.enclosing.join('>')}`),
    ).toEqual([]);
  });

  it('no raw SQL writes to lab_reports', () => {
    expect(rawSql).toEqual([]);
  });
});

// ─── 6b. the real transfer functions: report-write payloads ──────────────────────────────────────────────

describe('the real transfer functions never put a department in their report writes', () => {
  const reports = Object.create(LabReportService.prototype) as unknown as {
    rehomeReportsForAcceptedItem: (...a: unknown[]) => Promise<void>;
    moveReportsToBranch: (...a: unknown[]) => Promise<void>;
    markReportsReferralForSample: (...a: unknown[]) => Promise<void>;
  };
  const dataOf = (m: jest.Mock, call = 0): Record<string, unknown> =>
    firstArg<{ data: Record<string, unknown> }>(m, call).data;

  it('accept: rehome writes only the new branch', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      orderItem: { findFirst: jest.fn().mockResolvedValue({ branchId: 'A' }) },
      labReport: { updateMany },
    };
    await reports.rehomeReportsForAcceptedItem(tx, 't1', 'oi1', 'B', null, 'A');
    expect(Object.keys(dataOf(updateMany))).toEqual(['branchId']);
  });

  it('return: moveReportsToBranch writes the branch and the TAT reset, never a department', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    await reports.moveReportsToBranch(
      { labReport: { updateMany } },
      't1',
      ['r1'],
      'A',
    );
    const keys = Object.keys(dataOf(updateMany));
    expect(keys).toContain('branchId');
    expect(keys).not.toContain('departmentId');
  });

  it('return with no reports writes nothing at all', async () => {
    const updateMany = jest.fn();
    await reports.moveReportsToBranch(
      { labReport: { updateMany } },
      't1',
      [],
      'A',
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('accept: marking referral work writes only isReferral', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      orderSample: {
        findFirst: jest.fn().mockResolvedValue({
          branchId: 'B',
          tests: [{ orderItemId: 'oi1', labTestId: null }],
        }),
      },
      labReport: {
        findMany: jest.fn().mockResolvedValue([{ id: 'r1' }]),
        updateMany,
      },
    };
    await reports.markReportsReferralForSample(tx, 't1', 'sample-B');
    expect(dataOf(updateMany)).toEqual({ isReferral: true });
  });

  describe('accept / return / recall: re-pointing to a setup whose entry carries ANOTHER department', () => {
    const samples = Object.create(OrderSampleService.prototype) as unknown as {
      pointReportsAtBranchSetup: (...a: unknown[]) => Promise<void>;
    };
    const stubTx = (report: Row) => {
      const update = jest.fn().mockResolvedValue({});
      const tx = {
        labReport: { findMany: jest.fn().mockResolvedValue([report]), update },
        labTest: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ sourceMasterLabTestId: 'tenant-test' }),
          findMany: jest.fn().mockResolvedValue([{ id: 'B-copy' }]),
        },
        branchLabTest: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'entry-B',
              sourceLabTestId: 'B-copy',
              departmentId: PATH, // the receiving entry's department
              isDefault: true,
              isDuplicate: false,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              list: { isDefault: true },
            },
          ]),
        },
        branchLabPanelTest: { findMany: jest.fn().mockResolvedValue([]) },
      };
      return { tx, update };
    };
    const ALLOWED = new Set([
      'labTestId',
      'performingBranchLabTestId',
      'memberBranchLabTestId',
    ]);

    it('a single test: the re-point writes the test and entry pointers and NOT the entry department', async () => {
      const { tx, update } = stubTx({
        id: 'r1',
        labTestId: 'A-copy',
        memberBranchLabTestId: null,
        performingBranchLabTestId: null,
        orderItem: { branchLabPanelId: null, branchId: 'A' },
      });
      await samples.pointReportsAtBranchSetup(tx, 't1', 'B', ['r1']);
      const data = dataOf(update);
      expect(data.labTestId).toBe('B-copy');
      expect(data.performingBranchLabTestId).toBe('entry-B');
      expect(Object.keys(data).every((k) => ALLOWED.has(k))).toBe(true);
      expect(JSON.stringify(data)).not.toContain(PATH);
    });

    it('a panel member: the member pointer moves too, still no department', async () => {
      const { tx, update } = stubTx({
        id: 'r2',
        labTestId: 'A-copy',
        memberBranchLabTestId: 'member-A',
        performingBranchLabTestId: null,
        orderItem: { branchLabPanelId: 'panel-A', branchId: 'A' },
      });
      await samples.pointReportsAtBranchSetup(tx, 't1', 'B', ['r2']);
      const data = dataOf(update);
      expect(data.memberBranchLabTestId).toBe('entry-B');
      expect(Object.keys(data).every((k) => ALLOWED.has(k))).toBe(true);
    });

    it("back at the order's own branch (return / recall) the entry pointer is cleared and still no department is written", async () => {
      const { tx, update } = stubTx({
        id: 'r3',
        labTestId: 'B-copy',
        memberBranchLabTestId: null,
        performingBranchLabTestId: 'entry-B',
        orderItem: { branchLabPanelId: null, branchId: 'A' },
      });
      await samples.pointReportsAtBranchSetup(tx, 't1', 'A', ['r3']);
      const data = dataOf(update);
      expect(data.performingBranchLabTestId).toBeNull();
      expect(Object.keys(data).every((k) => ALLOWED.has(k))).toBe(true);
    });
  });
});
