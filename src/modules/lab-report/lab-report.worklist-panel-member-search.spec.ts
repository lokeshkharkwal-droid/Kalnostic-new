import { Prisma } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { LabReportNotFoundException } from './exceptions/lab-report.exceptions';
import { ListLabReportsDto } from './dto/list-lab-reports.dto';
import type { WorklistBranchScope } from './access/worklist-branch-scope';
import type { MemberEntryMatches } from './utils/member-test-match.util';
import {
  toWorklistRow,
  type LabReportListRow,
} from './entities/lab-report.entity';

const SINGLE_BRANCH: WorklistBranchScope = {
  rules: [{ branchId: 'b1', statuses: 'ALL' }],
};

/**
 * Technician -> Reporting: a report of a PANEL order line is one report per member test. Its order line is the panel
 * (no `BranchLabTest`), so the member is only known through `LabReport.memberBranchLabTestId`. The worklist judges a
 * panel's test by ITS OWN test entry - the name the search matches, the Lab Test filter and the Department column
 * (through the member entry), and, for the Department filter and who may see the row, the report's own stamped
 * `LabReport.departmentId` (the member test's own department, set when the report is created) - the same rule
 * Accession applies to a panel's samples. The list, the status-tab counts and the TAT summary share `buildListWhere`.
 */
describe('LabReportService — worklist: panel members are judged by their own test entry', () => {
  const deps = Array(11).fill(undefined) as unknown[];
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  const build = (
    filters: Partial<ListLabReportsDto>,
    members?: Partial<MemberEntryMatches>,
    scopeIds: string[] = [],
  ) =>
    (
      service as unknown as {
        buildListWhere: (
          tenantId: string,
          scope: WorklistBranchScope,
          f: ListLabReportsDto,
          scopeIds: string[],
          m?: MemberEntryMatches,
        ) => Prisma.LabReportWhereInput;
      }
    ).buildListWhere(
      't1',
      SINGLE_BRANCH,
      filters,
      scopeIds,
      members ? { search: [], testFilter: [], ...members } : undefined,
    );
  const andOf = (w: Prisma.LabReportWhereInput) =>
    Array.isArray(w.AND) ? w.AND : w.AND ? [w.AND] : [];
  /** The report-level alternatives that mention a panel member id (the filters' member clauses). */
  const memberClauses = (w: Prisma.LabReportWhereInput) =>
    andOf(w).filter((c) =>
      c.OR?.some((alt) => alt.memberBranchLabTestId !== undefined),
    );

  describe('search', () => {
    it('with no matching member nothing changes: the order-line search stays where it was', () => {
      const w = build({ search: 'lipid' });
      expect(w.orderItem?.OR).toHaveLength(4);
      expect(memberClauses(w)).toHaveLength(0);
      expect(build({ search: 'lipid' }, { search: [] })).toEqual(w);
    });

    it('a matching member entry is one more way for a report to match: order-line search OR member id', () => {
      const w = build({ search: 'lipid' }, { search: ['m1', 'm2'] });
      const clauses = memberClauses(w);
      expect(clauses).toHaveLength(1);
      const alts = clauses[0]!.OR as Prisma.LabReportWhereInput[];
      expect(alts).toHaveLength(2);
      expect(
        (alts[0]!.orderItem as Prisma.OrderItemWhereInput).OR,
      ).toHaveLength(4);
      expect(alts[1]).toEqual({ memberBranchLabTestId: { in: ['m1', 'm2'] } });
      expect(w.orderItem?.OR).toBeUndefined();
    });

    it('the branch scope is kept next to it (the member alternative never replaces it)', () => {
      const w = build({ search: 'lipid' }, { search: ['m1'] });
      expect(
        andOf(w).some(
          (c) => c.OR?.some((alt) => alt.branchId === 'b1') ?? false,
        ),
      ).toBe(true);
    });

    it('a blank search adds nothing, whatever member ids were resolved', () => {
      for (const blank of ['', '   ', '\n']) {
        const w = build({ search: blank }, { search: ['m1'] });
        expect(memberClauses(w)).toHaveLength(0);
        expect(w.orderItem?.OR).toBeUndefined();
      }
    });
  });

  describe('Lab Test filter', () => {
    it('with no member of that test nothing changes: the order line carries the filter', () => {
      const w = build({ branchLabTestId: 'T' });
      expect(w.orderItem?.branchLabTest).toEqual({
        OR: [{ id: 'T' }, { sourceLabTestId: 'T' }],
      });
      expect(memberClauses(w)).toHaveLength(0);
    });

    it('a member of the chosen test also matches: order-line test OR member id', () => {
      const w = build({ branchLabTestId: 'T' }, { testFilter: ['m1'] });
      expect(w.orderItem?.branchLabTest).toBeUndefined();
      const alts = memberClauses(w)[0]!.OR as Prisma.LabReportWhereInput[];
      expect(alts[0]).toEqual({
        orderItem: {
          branchLabTest: { OR: [{ id: 'T' }, { sourceLabTestId: 'T' }] },
        },
      });
      expect(alts[1]).toEqual({ memberBranchLabTestId: { in: ['m1'] } });
    });

    it('with a Department filter too: the department is on the report itself, so neither alternative carries one', () => {
      const w = build(
        { branchLabTestId: 'T', departmentId: 'D' },
        { testFilter: ['m1'] },
      );
      const alts = memberClauses(w)[0]!.OR as Prisma.LabReportWhereInput[];
      expect(alts[0]).toEqual({
        orderItem: {
          branchLabTest: { OR: [{ id: 'T' }, { sourceLabTestId: 'T' }] },
        },
      });
      expect(alts[1]).toEqual({ memberBranchLabTestId: { in: ['m1'] } });
      // a single test AND a panel test must both be in the department: the report's own stamped department
      expect(w.departmentId).toBe('D');
    });

    it('with a Department filter and no member of that test: the order line carries the test, the report the department', () => {
      const w = build({ branchLabTestId: 'T', departmentId: 'D' });
      expect(w.orderItem?.branchLabTest).toEqual({
        OR: [{ id: 'T' }, { sourceLabTestId: 'T' }],
      });
      expect(w.departmentId).toBe('D');
      expect(memberClauses(w)).toHaveLength(0);
    });
  });

  describe('Department filter', () => {
    it('alone: it is the report OWN stamped department - a single test, or a panel test own, never the panel', () => {
      const w = build({ departmentId: 'D' });
      expect(w.departmentId).toBe('D');
      // no join through the order line test / panel (that is what hid every panel test) and no member clause
      expect(w.orderItem?.branchLabTest).toBeUndefined();
      expect(w.orderItem?.branchLabPanel).toBeUndefined();
      expect(memberClauses(w)).toHaveLength(0);
    });

    it('no department: nothing is added', () => {
      const w = build({});
      expect(w.departmentId).toBeUndefined();
      expect(memberClauses(w)).toHaveLength(0);
      expect(w.orderItem?.AND).toBeUndefined();
      expect(w.orderItem?.branchLabTest).toBeUndefined();
    });

    it('it does not use the order line search slot, so search and department apply together', () => {
      const w = build({ departmentId: 'D', search: 'lipid' });
      expect(w.orderItem?.OR).toHaveLength(4);
      expect(w.departmentId).toBe('D');
    });

    it('it leaves the Lab Panel filter alone', () => {
      const w = build({ departmentId: 'D', branchLabPanelId: 'P' });
      expect(w.orderItem?.branchLabPanel).toEqual({
        OR: [{ id: 'P' }, { sourceLabPanelId: 'P' }],
      });
      expect(w.departmentId).toBe('D');
    });
  });

  it('search and Lab Test filter together: BOTH must hold (two separate alternatives)', () => {
    const w = build(
      { search: 'lipid', branchLabTestId: 'T' },
      { search: ['m1'], testFilter: ['m2'] },
    );
    expect(memberClauses(w)).toHaveLength(2);
  });

  describe('who may see a panel test (department access)', () => {
    /** The per-branch rule's "held by this branch" alternative for a report with no performing entry. */
    const heldLineRule = (w: Prisma.LabReportWhereInput) => {
      const perBranch = andOf(w).at(-1)!.OR as Prisma.LabReportWhereInput[];
      return (perBranch[0]!.OR as Prisma.LabReportWhereInput[])[0]!;
    };

    it('a single test or a panel test alike: the report own stamped department is unassigned or one of the user', () => {
      expect(heldLineRule(build({}, {}, ['d1']))).toEqual({
        performingBranchLabTestId: null,
        OR: [{ departmentId: null }, { departmentId: { in: ['d1'] } }],
      });
    });

    it('a user with no department is unrestricted: no department condition, only the branch-structure key', () => {
      expect(heldLineRule(build({}, {}, []))).toEqual({
        performingBranchLabTestId: null,
      });
    });

    it('it never joins through the order line test or panel, and never lists member ids (the panel department plays no part)', () => {
      const rule = JSON.stringify(andOf(build({}, {}, ['d1'])).at(-1));
      expect(rule).not.toContain('branchLabPanel');
      expect(rule).not.toContain('"orderItem"');
      expect(rule).not.toContain('memberBranchLabTestId');
    });

    it('a report sent to another branch still uses the receiving branch entry (the performing-entry rule is untouched)', () => {
      const perBranch = andOf(build({}, {}, ['d1'])).at(-1)!
        .OR as Prisma.LabReportWhereInput[];
      const held = perBranch[0]!.OR as Prisma.LabReportWhereInput[];
      expect(held[1]).toEqual({
        performingBranchLabTestId: { not: null },
        performingEntry: {
          is: {
            OR: [{ departmentId: null }, { departmentId: { in: ['d1'] } }],
          },
        },
      });
    });
  });
});

describe('LabReportService.resolveMemberEntryMatches', () => {
  type Args = { where: Record<string, unknown> };
  function build(
    reported: string[],
    answers: Partial<Record<string, string[]>> = {},
  ) {
    const labReport = {
      findMany: jest
        .fn<Promise<unknown[]>, [Args]>()
        .mockResolvedValue(
          reported.map((id) => ({ memberBranchLabTestId: id })),
        ),
    };
    // each lookup is told apart by the condition it carries
    const kind = (where: Record<string, unknown>) =>
      where.testName ? 'search' : 'testFilter';
    const branchLabTest = {
      findMany: jest.fn<Promise<unknown[]>, [Args]>((args) =>
        Promise.resolve(
          (answers[kind(args.where)] ?? []).map((id) => ({ id })),
        ),
      ),
    };
    const deps = Array(11).fill(undefined) as unknown[];
    deps[0] = { labReport, branchLabTest };
    const service = new LabReportService(
      ...(deps as ConstructorParameters<typeof LabReportService>),
    );
    const resolve = (f: Partial<ListLabReportsDto>) =>
      (
        service as unknown as {
          resolveMemberEntryMatches: (
            t: string,
            s: WorklistBranchScope,
            f: ListLabReportsDto,
          ) => Promise<MemberEntryMatches>;
        }
      ).resolveMemberEntryMatches('t1', SINGLE_BRANCH, f);
    const lookups = () =>
      branchLabTest.findMany.mock.calls.map((c) => c[0].where);
    return { resolve, labReport, branchLabTest, lookups };
  }

  it('looks at the member tests of reports in the caller branches only', async () => {
    const m = build(['m1']);
    await m.resolve({ search: 'lipid' });
    expect(m.labReport.findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        tenantId: 't1',
        deletedAt: null,
        memberBranchLabTestId: { not: null },
        branchId: 'b1',
      },
      distinct: ['memberBranchLabTestId'],
    });
  });

  it('no search and no Lab Test filter: nothing is looked up at all (the usual list load costs no extra query)', async () => {
    const m = build(['m1', 'm2'], { search: ['m1'], testFilter: ['m2'] });
    await expect(m.resolve({})).resolves.toEqual({
      search: [],
      testFilter: [],
    });
    await expect(m.resolve({ departmentId: 'D' })).resolves.toEqual({
      search: [],
      testFilter: [],
    });
    expect(m.labReport.findMany).not.toHaveBeenCalled();
    expect(m.branchLabTest.findMany).not.toHaveBeenCalled();
  });

  it('search: the member entries whose name contains the text (case-insensitive, trimmed, literal %)', async () => {
    const m = build(['m1', 'm2', 'm3'], { search: ['m2'] });
    const r = await m.resolve({ search: '  100%_x ' });
    expect(r.search).toEqual(['m2']);
    expect(m.lookups()).toContainEqual({
      id: { in: ['m1', 'm2', 'm3'] },
      deletedAt: null,
      testName: { contains: '100\\%\\_x', mode: 'insensitive' },
    });
  });

  it('Lab Test filter: the entry or any copy of the same test - the Department filter is not part of it (it is on the report)', async () => {
    const m = build([], { testFilter: ['c1', 'c2'] });
    const r = await m.resolve({ branchLabTestId: 'T', departmentId: 'D' });
    expect(r.testFilter).toEqual(['c1', 'c2']);
    expect(m.lookups()).toContainEqual({
      tenantId: 't1',
      deletedAt: null,
      OR: [{ id: 'T' }, { sourceLabTestId: 'T' }],
    });
    expect(m.lookups()[0]).not.toHaveProperty('departmentId');
  });

  it('no panel member on any report: the name search finds nothing and runs no lookup', async () => {
    const m = build([], { search: ['x'] });
    const r = await m.resolve({ search: 'lipid' });
    expect(r).toEqual({ search: [], testFilter: [] });
    expect(m.branchLabTest.findMany).not.toHaveBeenCalled();
  });

  it('a blank search: no name lookup runs', async () => {
    const m = build(['m1']);
    await m.resolve({ search: '   ', branchLabTestId: 'T' });
    expect(m.lookups().some((w) => 'testName' in w)).toBe(false);
  });
});

describe('toWorklistRow - the Department column is the department stamped on the report', () => {
  const row = (over: Record<string, unknown>) =>
    ({
      id: 'r1',
      status: 'PENDING',
      createdAt: new Date('2026-10-08T00:00:00Z'),
      branchId: 'b1',
      departmentId: null,
      performingEntry: null,
      orderItem: { branchLabTest: null, branchLabPanel: null },
      ...over,
    }) as unknown as LabReportListRow;

  it('shows the department stamped on the report', () => {
    expect(toWorklistRow(row({ departmentId: 'haem' })).departmentId).toBe(
      'haem',
    );
  });

  it('a test moved to another department AFTER the report was made does not change the column', () => {
    const r = toWorklistRow(
      row({
        departmentId: 'haem',
        orderItem: {
          branchLabTest: { departmentId: 'immu' },
          branchLabPanel: { departmentId: 'immu' },
        },
      }),
    );
    expect(r.departmentId).toBe('haem');
  });

  it('a report with no stamped department shows none, even when its order line test or panel has one now', () => {
    const r = toWorklistRow(
      row({
        departmentId: null,
        orderItem: {
          branchLabTest: { departmentId: 'immu' },
          branchLabPanel: { departmentId: 'immu' },
        },
      }),
    );
    expect(r.departmentId).toBeNull();
  });

  it("a report sent to another branch shows the receiving branch's entry department (even none)", () => {
    expect(
      toWorklistRow(
        row({ departmentId: 'haem', performingEntry: { departmentId: 'rad' } }),
      ).departmentId,
    ).toBe('rad');
    expect(
      toWorklistRow(
        row({ departmentId: 'haem', performingEntry: { departmentId: null } }),
      ).departmentId,
    ).toBeNull();
  });
});

describe('LabReportService.findByIdForViewer — opening one report (judged by the same department the column shows: the stamped one)', () => {
  function build(detailDepartment: string | null, scopeIds: string[]) {
    const deps = Array(11).fill(undefined) as unknown[];
    const service = new LabReportService(
      ...(deps as ConstructorParameters<typeof LabReportService>),
    );
    Object.assign(service, {
      userDepartmentScope: {
        resolveDepartmentIds: jest.fn().mockResolvedValue(scopeIds),
      },
    });
    const detail = { id: 'r1', departmentId: detailDepartment };
    const spy = jest
      .spyOn(service, 'findByIdForApi')
      .mockResolvedValue(detail as never);
    return { service, spy, detail };
  }

  it('a report with no department is open to everyone, whatever their departments', async () => {
    const m = build(null, []);
    await expect(
      m.service.findByIdForViewer('r1', 't1', 'b1', 'p1'),
    ).resolves.toBe(m.detail);
    expect(m.spy).toHaveBeenCalledWith('r1', 't1', 'b1');
  });

  it("a report in one of the user's departments is open", async () => {
    const m = build('bio', ['bio', 'rad']);
    await expect(
      m.service.findByIdForViewer('r1', 't1', 'b1', 'p1'),
    ).resolves.toBe(m.detail);
  });

  it('a report in another department behaves as not found', async () => {
    const m = build('rad', ['bio']);
    await expect(
      m.service.findByIdForViewer('r1', 't1', 'b1', 'p1'),
    ).rejects.toBeInstanceOf(LabReportNotFoundException);
  });

  it('a user with no department is unrestricted: a report that has a department opens too (the worklist lists it for them)', async () => {
    const m = build('bio', []);
    await expect(
      m.service.findByIdForViewer('r1', 't1', 'b1', 'p1'),
    ).resolves.toBe(m.detail);
  });

  it("the user's own departments are the ones asked for", async () => {
    const m = build('bio', ['bio']);
    await m.service.findByIdForViewer('r1', 't1', 'b1', 'person-9');
    const asked = (
      m.service as unknown as {
        userDepartmentScope: { resolveDepartmentIds: jest.Mock };
      }
    ).userDepartmentScope.resolveDepartmentIds;
    expect(asked).toHaveBeenCalledWith('t1', 'person-9');
  });
});

describe('Lab Test / Lab Panel dropdowns - a catalogue of the branch, NOT filtered by department (like Accession)', () => {
  type Row = { id: string; name: string; sourceId: string | null };

  /** A service whose branch test / panel tables return `rows` (already name-sorted, as the query orders them). */
  function build(kind: 'test' | 'panel', rows: Row[]) {
    const findMany = jest
      .fn<Promise<unknown[]>, [{ where: Record<string, unknown> }]>()
      .mockResolvedValue(
        rows.map((r) =>
          kind === 'test'
            ? { id: r.id, testName: r.name, sourceLabTestId: r.sourceId }
            : { id: r.id, panelName: r.name, sourceLabPanelId: r.sourceId },
        ),
      );
    const deps = Array(11).fill(undefined) as unknown[];
    deps[0] =
      kind === 'test'
        ? { branchLabTest: { findMany } }
        : { branchLabPanel: { findMany } };
    const service = new LabReportService(
      ...(deps as ConstructorParameters<typeof LabReportService>),
    );
    const options = async (
      query: { search?: string; page?: number; limit?: number } = {},
    ) =>
      kind === 'test'
        ? await service.getLabTestOptions('t1', 'b1', query)
        : await service.getLabPanelOptions('t1', 'b1', query);
    const names = async (
      query: { search?: string; page?: number; limit?: number } = {},
    ) => (await options(query)).data.map((o) => o.name);
    const lastWhere = () => findMany.mock.calls.at(-1)![0].where;
    return { options, names, lastWhere, findMany, service };
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

      it('lists every active entry of the branch: the query has no department condition at all', async () => {
        const m = build(kind, [row('1', 'Alpha')]);
        await m.names();
        const where = m.lastWhere();
        expect(where).toMatchObject({
          tenantId: 't1',
          branchId: 'b1',
          isActive: true,
          deletedAt: null,
        });
        expect(JSON.stringify(where)).not.toContain('department');
        expect(where).not.toHaveProperty('OR');
      });

      it('needs no user: only the tenant and the active branch decide the list', async () => {
        const m = build(kind, [row('1', 'Alpha'), row('2', 'Beta')]);
        expect(await m.names()).toEqual(['Alpha', 'Beta']);
      });

      it('returns the shared source id when there is one, else the own id', async () => {
        const m = build(kind, [row('1', 'Alpha', 'S1'), row('2', 'Beta')]);
        expect((await m.options()).data).toEqual([
          { id: 'S1', name: 'Alpha' },
          { id: '2', name: 'Beta' },
        ]);
      });

      it('copies of one master entry (one per pricing list) are listed once, under the first copy', async () => {
        const m = build(kind, [
          row('1', 'Alpha A', 'M'),
          row('2', 'Alpha B', 'M'),
          row('3', 'Beta'),
        ]);
        expect(await m.names()).toEqual(['Alpha A', 'Beta']);
        expect((await m.options()).total).toBe(2);
      });

      it('a trimmed name search is applied on top, case-insensitively', async () => {
        const m = build(kind, [row('1', 'Alpha')]);
        await m.names({ search: '  alp ' });
        expect(m.lastWhere()).toMatchObject({
          [nameKey]: { contains: 'alp', mode: 'insensitive' },
        });
        await m.names({ search: '   ' });
        expect(m.lastWhere()).not.toHaveProperty(nameKey);
      });

      it('% _ and a backslash in the search are matched as typed, never as wildcards', async () => {
        const m = build(kind, [row('1', 'Alpha')]);
        await m.names({ search: '100%_x\\y' });
        expect(m.lastWhere()).toMatchObject({
          [nameKey]: { contains: '100\\%\\_x\\\\y', mode: 'insensitive' },
        });
        await m.names({ search: '%' });
        expect(m.lastWhere()).toMatchObject({
          [nameKey]: { contains: '\\%', mode: 'insensitive' },
        });
      });

      it('the page and the page size still apply', async () => {
        const m = build(kind, [
          row('1', 'Alpha'),
          row('2', 'Beta'),
          row('3', 'Gamma'),
        ]);
        expect(await m.names({ page: 1, limit: 2 })).toEqual(['Alpha', 'Beta']);
        expect(await m.names({ page: 2, limit: 2 })).toEqual(['Gamma']);
        expect((await m.options({ page: 1, limit: 2 })).total).toBe(3);
      });

      it('no active branch is refused (the dropdown is branch-wide, never tenant-wide)', async () => {
        const m = build(kind, []);
        await expect(
          kind === 'test'
            ? m.service.getLabTestOptions('t1', null, {})
            : m.service.getLabPanelOptions('t1', null, {}),
        ).rejects.toBeDefined();
        expect(m.findMany).not.toHaveBeenCalled();
      });
    },
  );
});
