import { Prisma } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { LabReportNotFoundException } from './exceptions/lab-report.exceptions';
import { ListLabReportsDto } from './dto/list-lab-reports.dto';
import type { WorklistBranchScope } from './access/worklist-branch-scope';
import type { MemberEntryMatches } from './utils/member-test-match.util';
import type { LabReportWorklistRow } from './entities/lab-report.entity';

const SINGLE_BRANCH: WorklistBranchScope = {
  rules: [{ branchId: 'b1', statuses: 'ALL' }],
};

/**
 * Technician -> Reporting: a report of a PANEL order line is one report per member test. Its order line is the panel
 * (no `BranchLabTest`), so the member is only known through `LabReport.memberBranchLabTestId`. The worklist judges a
 * panel's test by ITS OWN test entry - the name the search matches, the Lab Test filter, and the department (the
 * Department column, the Department filter and who may see the row) - the same rule Accession applies to a panel's
 * samples. The list, the status-tab counts and the TAT summary share `buildListWhere`.
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
      members
        ? { search: [], testFilter: [], department: [], hidden: [], ...members }
        : undefined,
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

    it("with a Department filter too: a single test must be in that department; a member's own department was already applied when its ids were resolved", () => {
      const w = build(
        { branchLabTestId: 'T', departmentId: 'D' },
        { testFilter: ['m1'] },
      );
      const alts = memberClauses(w)[0]!.OR as Prisma.LabReportWhereInput[];
      expect(alts[0]).toEqual({
        orderItem: {
          branchLabTest: {
            departmentId: 'D',
            OR: [{ id: 'T' }, { sourceLabTestId: 'T' }],
          },
        },
      });
      // no condition on the panel: the member's OWN department decides
      expect(alts[1]).toEqual({ memberBranchLabTestId: { in: ['m1'] } });
    });

    it('with a Department filter and no member of that test: the old order-line rule, unchanged', () => {
      const w = build({ branchLabTestId: 'T', departmentId: 'D' });
      expect(w.orderItem?.branchLabTest).toEqual({
        departmentId: 'D',
        OR: [{ id: 'T' }, { sourceLabTestId: 'T' }],
      });
      expect(memberClauses(w)).toHaveLength(0);
    });
  });

  describe('Department filter', () => {
    it("alone: a single test / an unsplit panel line by the order line's department, a panel's test by ITS OWN department", () => {
      const w = build({ departmentId: 'D' }, { department: ['m1', 'm2'] });
      const clauses = memberClauses(w);
      expect(clauses).toHaveLength(1);
      expect(clauses[0]!.OR).toEqual([
        {
          memberBranchLabTestId: null,
          orderItem: {
            OR: [
              { branchLabTest: { is: { departmentId: 'D' } } },
              { branchLabPanel: { is: { departmentId: 'D' } } },
            ],
          },
        },
        { memberBranchLabTestId: { in: ['m1', 'm2'] } },
      ]);
      // never on the order line's test by itself: that is what hid every panel test
      expect(w.orderItem?.branchLabTest).toBeUndefined();
    });

    it('a panel whose tests are in no such department lists none of them (an empty member list matches nothing)', () => {
      const w = build({ departmentId: 'D' }, { department: [] });
      const alts = memberClauses(w)[0]!.OR as Prisma.LabReportWhereInput[];
      expect(alts[1]).toEqual({ memberBranchLabTestId: { in: [] } });
    });

    it('no department: nothing is added', () => {
      const w = build({});
      expect(memberClauses(w)).toHaveLength(0);
      expect(w.orderItem?.AND).toBeUndefined();
      expect(w.orderItem?.branchLabTest).toBeUndefined();
    });

    it("it does not use the order line's search slot, so search and department apply together", () => {
      const w = build({ departmentId: 'D', search: 'lipid' });
      expect(w.orderItem?.OR).toHaveLength(4);
      expect(memberClauses(w)).toHaveLength(1);
    });

    it('it leaves the Lab Panel filter alone', () => {
      const w = build({ departmentId: 'D', branchLabPanelId: 'P' });
      expect(w.orderItem?.branchLabPanel).toEqual({
        OR: [{ id: 'P' }, { sourceLabPanelId: 'P' }],
      });
      expect(memberClauses(w)).toHaveLength(1);
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
      const held = (perBranch[0]!.OR as Prisma.LabReportWhereInput[])[0]!;
      return held.OR as Prisma.LabReportWhereInput[];
    };

    it("a single test or an unsplit panel line: the order line's department (as before)", () => {
      const [line] = heldLineRule(build({}, {}, ['d1']));
      expect(line).toEqual({
        memberBranchLabTestId: null,
        orderItem: {
          is: {
            OR: [
              { branchLabTest: { is: { departmentId: null } } },
              { branchLabPanel: { is: { departmentId: null } } },
              { branchLabTest: { is: { departmentId: { in: ['d1'] } } } },
              { branchLabPanel: { is: { departmentId: { in: ['d1'] } } } },
            ],
          },
        },
      });
    });

    it("a panel's test: visible unless ITS OWN department is one the user is not in (the panel's department is ignored)", () => {
      const rule = heldLineRule(build({}, { hidden: ['h1', 'h2'] }, ['d1']));
      expect(rule[1]).toEqual({
        memberBranchLabTestId: { not: null, notIn: ['h1', 'h2'] },
      });
    });

    it('a user with no department: every panel test with a department is hidden, one with none stays visible', () => {
      const rule = heldLineRule(build({}, { hidden: ['h1'] }, []));
      expect(rule[1]).toEqual({
        memberBranchLabTestId: { not: null, notIn: ['h1'] },
      });
    });

    it('with nothing hidden every panel test passes (not-in an empty list)', () => {
      expect(heldLineRule(build({}, {}, ['d1']))[1]).toEqual({
        memberBranchLabTestId: { not: null, notIn: [] },
      });
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
    const kind = (where: Record<string, unknown>) => {
      const dept = where.departmentId;
      if (where.testName) return 'search';
      if (where.OR) return 'testFilter';
      if (dept && typeof dept === 'object') return 'hidden';
      return 'department';
    };
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
    const resolve = (
      f: Partial<ListLabReportsDto>,
      scopeIds: string[] = ['d1'],
    ) =>
      (
        service as unknown as {
          resolveMemberEntryMatches: (
            t: string,
            s: WorklistBranchScope,
            f: ListLabReportsDto,
            ids: string[],
          ) => Promise<MemberEntryMatches>;
        }
      ).resolveMemberEntryMatches('t1', SINGLE_BRANCH, f, scopeIds);
    const lookups = () =>
      branchLabTest.findMany.mock.calls.map((c) => c[0].where);
    return { resolve, labReport, branchLabTest, lookups };
  }

  it("looks at the member tests of reports in the caller's branches only", async () => {
    const m = build(['m1']);
    await m.resolve({});
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

  it('no filter: only the "hidden by department" lookup runs (it is part of who may see a row)', async () => {
    const m = build(['m1', 'm2'], { hidden: ['m2'] });
    await expect(m.resolve({})).resolves.toEqual({
      search: [],
      testFilter: [],
      department: [],
      hidden: ['m2'],
    });
    expect(m.lookups()).toHaveLength(1);
    expect(m.lookups()[0]).toMatchObject({
      id: { in: ['m1', 'm2'] },
      deletedAt: null,
      departmentId: { not: null, notIn: ['d1'] },
    });
  });

  it('a user with no department: every member entry that has a department is hidden', async () => {
    const m = build(['m1']);
    await m.resolve({}, []);
    expect(m.lookups()[0]!.departmentId).toEqual({ not: null });
  });

  it('Department filter: the member entries whose own department is that one', async () => {
    const m = build(['m1', 'm2'], { department: ['m1'] });
    const r = await m.resolve({ departmentId: 'D' });
    expect(r.department).toEqual(['m1']);
    expect(m.lookups()).toContainEqual({
      id: { in: ['m1', 'm2'] },
      deletedAt: null,
      departmentId: 'D',
    });
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

  it("Lab Test filter: the entry or any copy of the same test, narrowed to the Department filter's department", async () => {
    const m = build([], { testFilter: ['c1', 'c2'] });
    const r = await m.resolve({ branchLabTestId: 'T', departmentId: 'D' });
    expect(r.testFilter).toEqual(['c1', 'c2']);
    expect(m.lookups()).toContainEqual({
      tenantId: 't1',
      deletedAt: null,
      OR: [{ id: 'T' }, { sourceLabTestId: 'T' }],
      departmentId: 'D',
    });
    const noDept = build([], { testFilter: ['c1'] });
    await noDept.resolve({ branchLabTestId: 'T' });
    expect(noDept.lookups()[0]).not.toHaveProperty('departmentId');
  });

  it('no panel member on any report: only the Lab Test filter (which does not depend on reports) is looked up', async () => {
    const m = build([], { hidden: ['x'], search: ['x'], department: ['x'] });
    const r = await m.resolve({ search: 'lipid', departmentId: 'D' });
    expect(r).toEqual({
      search: [],
      testFilter: [],
      department: [],
      hidden: [],
    });
    expect(m.branchLabTest.findMany).not.toHaveBeenCalled();
  });

  it('a blank search and no department: neither lookup runs', async () => {
    const m = build(['m1']);
    await m.resolve({ search: '   ' });
    expect(m.lookups().some((w) => 'testName' in w)).toBe(false);
    expect(m.lookups().some((w) => w.departmentId === 'D')).toBe(false);
  });
});

describe('LabReportService.attachMemberDepartments — the Department column of a panel test', () => {
  const rowOf = (id: string, departmentId: string | null) =>
    ({ id, departmentId, department: null }) as unknown as LabReportWorklistRow;
  function build(entries: Array<{ id: string; departmentId: string | null }>) {
    const branchLabTest = {
      findMany: jest.fn().mockResolvedValue(entries),
    };
    const deps = Array(11).fill(undefined) as unknown[];
    deps[0] = { branchLabTest };
    const service = new LabReportService(
      ...(deps as ConstructorParameters<typeof LabReportService>),
    );
    const run = (
      rows: LabReportWorklistRow[],
      sources: Array<{
        id: string;
        memberBranchLabTestId: string | null;
        performingEntry: unknown;
      }>,
    ) =>
      (
        service as unknown as {
          attachMemberDepartments: (
            r: LabReportWorklistRow[],
            s: typeof sources,
          ) => Promise<LabReportWorklistRow[]>;
        }
      ).attachMemberDepartments(rows, sources);
    return { run, branchLabTest };
  }

  it("a panel's test shows its OWN department, not the panel's", async () => {
    const m = build([{ id: 'e1', departmentId: 'bio' }]);
    const out = await m.run(
      [rowOf('r1', 'panel-dept')],
      [{ id: 'r1', memberBranchLabTestId: 'e1', performingEntry: null }],
    );
    expect(out[0]!.departmentId).toBe('bio');
  });

  it("a panel's test whose own entry has no department shows none (not the panel's)", async () => {
    const m = build([{ id: 'e1', departmentId: null }]);
    const out = await m.run(
      [rowOf('r1', 'panel-dept')],
      [{ id: 'r1', memberBranchLabTestId: 'e1', performingEntry: null }],
    );
    expect(out[0]!.departmentId).toBeNull();
  });

  it('a member entry that was deleted gives no department', async () => {
    const m = build([]);
    const out = await m.run(
      [rowOf('r1', 'panel-dept')],
      [{ id: 'r1', memberBranchLabTestId: 'gone', performingEntry: null }],
    );
    expect(out[0]!.departmentId).toBeNull();
  });

  it('a report sent to another branch keeps the receiving branch entry department', async () => {
    const m = build([{ id: 'e1', departmentId: 'bio' }]);
    const out = await m.run(
      [rowOf('r1', 'receiver-dept')],
      [{ id: 'r1', memberBranchLabTestId: 'e1', performingEntry: { id: 'p' } }],
    );
    expect(out[0]!.departmentId).toBe('receiver-dept');
  });

  it('a single test and an unsplit panel line keep the order line department, and cost no lookup', async () => {
    const m = build([{ id: 'e1', departmentId: 'bio' }]);
    const out = await m.run(
      [rowOf('r1', 'line-dept')],
      [{ id: 'r1', memberBranchLabTestId: null, performingEntry: null }],
    );
    expect(out[0]!.departmentId).toBe('line-dept');
    expect(m.branchLabTest.findMany).not.toHaveBeenCalled();
  });

  it('many rows, one batched lookup', async () => {
    const m = build([
      { id: 'e1', departmentId: 'bio' },
      { id: 'e2', departmentId: 'rad' },
    ]);
    const out = await m.run(
      [
        rowOf('r1', 'x'),
        rowOf('r2', 'x'),
        rowOf('r3', 'x'),
        rowOf('r4', 'keep'),
      ],
      [
        { id: 'r1', memberBranchLabTestId: 'e1', performingEntry: null },
        { id: 'r2', memberBranchLabTestId: 'e2', performingEntry: null },
        { id: 'r3', memberBranchLabTestId: 'e1', performingEntry: null },
        { id: 'r4', memberBranchLabTestId: null, performingEntry: null },
      ],
    );
    expect(out.map((r) => r.departmentId)).toEqual([
      'bio',
      'rad',
      'bio',
      'keep',
    ]);
    expect(m.branchLabTest.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('LabReportService.findByIdForViewer — opening one report', () => {
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

  it('a user with no department can open only reports that have none', async () => {
    const hidden = build('bio', []);
    await expect(
      hidden.service.findByIdForViewer('r1', 't1', 'b1', 'p1'),
    ).rejects.toBeInstanceOf(LabReportNotFoundException);
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

describe('LabReportService.getLabPanelOptions — a panel is offered by the tests inside it', () => {
  type Panel = {
    id: string;
    panelName: string;
    sourceLabPanelId: string | null;
    departmentId: string | null;
  };
  /** panels, their test links (panel id -> test entry ids) and the live test entries (id -> own department). */
  function build(
    panels: Panel[],
    links: Record<string, string[]>,
    entries: Record<string, string | null>,
    scopeIds: string[],
  ) {
    const branchLabPanel = {
      findMany: jest
        .fn<Promise<Panel[]>, [{ where: Record<string, unknown> }]>()
        .mockResolvedValue(panels),
    };
    const branchLabPanelTest = {
      findMany: jest.fn().mockResolvedValue(
        Object.entries(links).flatMap(([panelId, tests]) =>
          tests.map((t) => ({
            branchLabPanelId: panelId,
            branchLabTestId: t,
          })),
        ),
      ),
    };
    const branchLabTest = {
      findMany: jest.fn().mockResolvedValue(
        Object.entries(entries).map(([id, departmentId]) => ({
          id,
          departmentId,
        })),
      ),
    };
    const deps = Array(11).fill(undefined) as unknown[];
    deps[0] = { branchLabPanel, branchLabPanelTest, branchLabTest };
    const service = new LabReportService(
      ...(deps as ConstructorParameters<typeof LabReportService>),
    );
    Object.assign(service, {
      userDepartmentScope: {
        resolveDepartmentIds: jest.fn().mockResolvedValue(scopeIds),
      },
    });
    const options = async (
      query: { search?: string; page?: number; limit?: number } = {},
    ) =>
      (await service.getLabPanelOptions('t1', 'b1', 'p1', query)).data.map(
        (o) => o.name,
      );
    return { options, branchLabPanel, branchLabPanelTest, branchLabTest };
  }
  const panel = (
    id: string,
    name: string,
    dept: string | null = null,
    master: string | null = null,
  ): Panel => ({
    id,
    panelName: name,
    sourceLabPanelId: master,
    departmentId: dept,
  });

  it("offered when the user can see one of its tests, whatever the panel's own department", async () => {
    const m = build(
      [panel('p1', 'Liver', 'zzz')],
      { p1: ['t1', 't2'] },
      { t1: 'bio', t2: 'rad' },
      ['bio'],
    );
    expect(await m.options()).toEqual(['Liver']);
  });

  it("not offered when the user can see none of its tests, even when it is the panel's own department or the panel has none", async () => {
    const own = build(
      [panel('p1', 'Liver', 'bio')],
      { p1: ['t1', 't2'] },
      { t1: 'rad', t2: 'path' },
      ['bio'],
    );
    expect(await own.options()).toEqual([]);
    const none = build(
      [panel('p1', 'Liver', null)],
      { p1: ['t1'] },
      { t1: 'rad' },
      ['bio'],
    );
    expect(await none.options()).toEqual([]);
  });

  it('a test with no department is visible to everyone, so it makes its panel offered to everyone', async () => {
    const m = build(
      [panel('p1', 'Liver')],
      { p1: ['t1', 't2'] },
      { t1: 'rad', t2: null },
      [],
    );
    expect(await m.options()).toEqual(['Liver']);
  });

  it('a user with no department is offered only panels that have a test with no department', async () => {
    const m = build(
      [panel('p1', 'A'), panel('p2', 'B')],
      { p1: ['t1'], p2: ['t2'] },
      { t1: 'bio', t2: null },
      [],
    );
    expect(await m.options()).toEqual(['B']);
  });

  it("a panel with no tests keeps the old rule: its own department unassigned or the user's", async () => {
    const m = build(
      [
        panel('p1', 'Free'),
        panel('p2', 'Mine', 'bio'),
        panel('p3', 'Theirs', 'rad'),
      ],
      {},
      {},
      ['bio'],
    );
    expect(await m.options()).toEqual(['Free', 'Mine']);
  });

  it('a panel whose tests were all removed (no live test entry) also falls back to its own department', async () => {
    const m = build(
      [panel('p1', 'Gone', 'rad'), panel('p2', 'GoneFree')],
      { p1: ['x'], p2: ['y'] },
      {},
      ['bio'],
    );
    expect(await m.options()).toEqual(['GoneFree']);
  });

  it('copies of one master panel are offered once, under the first copy the user may see', async () => {
    const m = build(
      [panel('p1', 'Liver A', null, 'M'), panel('p2', 'Liver B', null, 'M')],
      { p1: ['t1'], p2: ['t2'] },
      { t1: 'rad', t2: 'bio' },
      ['bio'],
    );
    expect(await m.options()).toEqual(['Liver B']);
  });

  it('the name search, the page and the page size still apply on top', async () => {
    const m = build(
      [panel('p1', 'Alpha'), panel('p2', 'Beta'), panel('p3', 'Gamma')],
      { p1: ['t'], p2: ['t'], p3: ['t'] },
      { t: null },
      [],
    );
    expect(await m.options({ page: 1, limit: 2 })).toEqual(['Alpha', 'Beta']);
    expect(await m.options({ page: 2, limit: 2 })).toEqual(['Gamma']);
    await m.options({ search: '  alp ' });
    expect(m.branchLabPanel.findMany.mock.calls.at(-1)![0].where).toMatchObject(
      {
        panelName: { contains: 'alp', mode: 'insensitive' },
      },
    );
  });

  it('no panels: no further lookups', async () => {
    const m = build([], {}, {}, ['bio']);
    expect(await m.options()).toEqual([]);
    expect(m.branchLabPanelTest.findMany).not.toHaveBeenCalled();
    expect(m.branchLabTest.findMany).not.toHaveBeenCalled();
  });

  it("the panel's department is no longer a condition of the panel query itself", async () => {
    const m = build(
      [panel('p1', 'Liver', 'rad')],
      { p1: ['t1'] },
      { t1: null },
      ['bio'],
    );
    await m.options();
    const where = m.branchLabPanel.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty('departmentId');
    expect(where).not.toHaveProperty('OR');
  });
});
