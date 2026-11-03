import { Prisma } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { LabReportController } from './lab-report.controller';
import { LabReportNotFoundException } from './exceptions/lab-report.exceptions';
import type { WorklistBranchScope } from './access/worklist-branch-scope';
import type { LabReportWorklistRow } from './entities/lab-report.entity';

/**
 * Edge cases of the department flow of the Technician worklist that the other specs do not pin: the Department
 * filter next to the user's own visibility, several branches at once, the status counts, the Department name lookup
 * (a deleted department), the Department dropdown, the controller (the dropdowns need no user) and opening a report.
 */

type Where = Prisma.LabReportWhereInput;
type AnyService = {
  buildListWhere: (
    tenantId: string,
    scope: WorklistBranchScope,
    filters: object,
    scopeIds: string[],
  ) => Where;
  attachDepartmentNames: (
    tenantId: string,
    rows: LabReportWorklistRow[],
  ) => Promise<LabReportWorklistRow[]>;
};

const SINGLE: WorklistBranchScope = {
  rules: [{ branchId: 'A', statuses: 'ALL' }],
};
const deps = () => Array(11).fill(undefined) as unknown[];
const makeService = (d: unknown[] = deps()) =>
  new LabReportService(
    ...(d as ConstructorParameters<typeof LabReportService>),
  );
const andOf = (w: Where): Where[] =>
  Array.isArray(w.AND) ? w.AND : w.AND ? [w.AND] : [];
/** The department-visibility fragment: the last AND entry (ANDed after the branch rule). */
const departmentBlock = (w: Where): Where => andOf(w).at(-1)!;

describe('department flow - the Department filter and the visibility rule are BOTH applied', () => {
  const service = makeService() as unknown as AnyService;
  const build = (
    filters: object,
    scopeIds: string[],
    scope: WorklistBranchScope = SINGLE,
  ) => service.buildListWhere('t1', scope, filters, scopeIds);

  it('a user in X asking for department Y gets BOTH conditions, so the answer is empty - the filter never widens access', () => {
    const w = build({ departmentId: 'Y' }, ['X']);
    expect(w.departmentId).toBe('Y');
    const text = JSON.stringify(departmentBlock(w));
    expect(text).toContain('"X"');
    expect(text).not.toContain('"Y"');
  });

  it('a user with no department is unrestricted (no visibility condition), so only the Department filter they chose applies', () => {
    const w = build({ departmentId: 'Y' }, []);
    expect(w.departmentId).toBe('Y');
    expect(JSON.stringify(departmentBlock(w))).not.toContain(
      '"departmentId":null',
    );
  });

  it('no filter: only the visibility rule is there', () => {
    const w = build({}, ['X']);
    expect(w.departmentId).toBeUndefined();
    expect(JSON.stringify(departmentBlock(w))).toContain('"X"');
  });

  it('a user in several departments is offered the union of them (an IN list, not one condition each)', () => {
    const text = JSON.stringify(departmentBlock(build({}, ['X', 'Y', 'Z'])));
    expect(text).toContain('"in":["X","Y","Z"]');
  });

  it('every branch of a multi-branch scope gets its own department rule, so the departments are judged per branch', () => {
    const scope: WorklistBranchScope = {
      rules: [
        { branchId: 'A', statuses: 'ALL' },
        { branchId: 'B', statuses: 'ALL', senderLinked: true },
      ],
      ownBranchId: 'A',
    };
    const block = departmentBlock(build({}, ['X'], scope)) as {
      OR: Where[];
    };
    expect(block.OR).toHaveLength(2);
    const [forA, forB] = block.OR;
    expect(forA!.branchId).toBe('A');
    // B is also a sender: what it holds, or only sent, each have their own alternative
    expect(forB!.OR).toHaveLength(2);
  });

  it('the department rule is ANDed with the status tab and the branch rule, never replacing them', () => {
    const w = build({ status: 'PENDING' }, ['X']);
    expect(w.status).toBe('PENDING');
    expect(w.tenantId).toBe('t1');
    expect(w.deletedAt).toBeNull();
    expect(andOf(w).length).toBeGreaterThan(0);
  });

  it('the department filter combines with the search and with the Lab Test filter without dropping either', () => {
    const w = build(
      { departmentId: 'Y', search: 'lipid', branchLabTestId: 'T' },
      ['Y'],
    );
    expect(w.departmentId).toBe('Y');
    expect(w.orderItem?.OR).toBeDefined();
    expect(w.orderItem?.branchLabTest).toBeDefined();
  });
});

describe('department flow - the status counts use the same department rule as the list', () => {
  function build(scopeIds: string[]) {
    const count = jest
      .fn<Promise<number>, [{ where: Where }]>()
      .mockResolvedValue(0);
    const service = makeService();
    Object.assign(service, {
      prisma: {
        labReport: { count, findMany: jest.fn().mockResolvedValue([]) },
      },
      userDepartmentScope: {
        resolveDepartmentIds: jest.fn().mockResolvedValue(scopeIds),
      },
    });
    const run = (filters: object = {}) =>
      service.getCounts('t1', SINGLE, filters, 'p1');
    const wheres = () => count.mock.calls.map((c) => c[0].where);
    return { run, wheres, count };
  }

  it('every count query (the All tag, each status tab and both source pills) carries the department visibility rule', async () => {
    const m = build(['X']);
    await m.run();
    const all = m.wheres();
    // 1 All + 9 status tabs + 2 source pills
    expect(all.length).toBe(1 + 9 + 2);
    for (const w of all) {
      expect(JSON.stringify(w)).toContain('"X"');
    }
  });

  it('a user with no department is unrestricted: no count carries a department condition', async () => {
    const m = build([]);
    await m.run();
    for (const w of m.wheres()) {
      expect(JSON.stringify(departmentBlock(w))).not.toContain(
        '"departmentId":null',
      );
    }
  });

  it('the Department filter reaches every count, so the tags agree with the rows the filter lists', async () => {
    const m = build(['X', 'Y']);
    await m.run({ departmentId: 'Y' });
    for (const w of m.wheres()) {
      expect(w.departmentId).toBe('Y');
    }
  });

  it('a plain count costs no panel-member lookups (no search and no Lab Test filter)', async () => {
    const m = build(['X']);
    await m.run({ departmentId: 'X' });
    // only labReport.count is used: the member resolution would call labReport.findMany
    expect(m.count).toHaveBeenCalled();
  });
});

describe('department flow - the Department column name', () => {
  const rowOf = (id: string, departmentId: string | null) =>
    ({ id, departmentId, department: null }) as unknown as LabReportWorklistRow;
  function build(known: Array<{ id: string; name: string }>) {
    const findMany = jest
      .fn<Promise<unknown[]>, [{ where: Record<string, unknown> }]>()
      .mockResolvedValue(known);
    const service = makeService();
    Object.assign(service, { prisma: { department: { findMany } } });
    return {
      findMany,
      run: (rows: LabReportWorklistRow[]) =>
        (service as unknown as AnyService).attachDepartmentNames('t1', rows),
    };
  }

  it('shows the department name for a live department', async () => {
    const m = build([{ id: 'd1', name: 'Haematology' }]);
    const [r] = await m.run([rowOf('r1', 'd1')]);
    expect(r!.department).toEqual({ id: 'd1', name: 'Haematology' });
  });

  it('a department that was deleted keeps the stamped id but shows no name (the row stays listed)', async () => {
    const m = build([]); // the lookup filters deleted departments out
    const [r] = await m.run([rowOf('r1', 'gone')]);
    expect(r!.departmentId).toBe('gone');
    expect(r!.department).toBeNull();
  });

  it('the lookup is tenant-scoped and ignores deleted departments', async () => {
    const m = build([]);
    await m.run([rowOf('r1', 'd1')]);
    expect(m.findMany.mock.calls[0]![0]).toMatchObject({
      where: { tenantId: 't1', deletedAt: null, id: { in: ['d1'] } },
    });
  });

  it('many rows with the same department cost ONE lookup with each id once', async () => {
    const m = build([
      { id: 'd1', name: 'A' },
      { id: 'd2', name: 'B' },
    ]);
    const out = await m.run([
      rowOf('r1', 'd1'),
      rowOf('r2', 'd2'),
      rowOf('r3', 'd1'),
    ]);
    expect(m.findMany).toHaveBeenCalledTimes(1);
    expect(m.findMany.mock.calls[0]![0].where.id).toEqual({ in: ['d1', 'd2'] });
    expect(out.map((r) => r.department?.name)).toEqual(['A', 'B', 'A']);
  });

  it('rows with no department cost no lookup at all', async () => {
    const m = build([]);
    const out = await m.run([rowOf('r1', null), rowOf('r2', null)]);
    expect(m.findMany).not.toHaveBeenCalled();
    expect(out.every((r) => r.department === null)).toBe(true);
  });
});

describe('department flow - the Department dropdown (getOptions) lists every department', () => {
  it('is not scoped to the caller: only the tenant and "not deleted" decide it', async () => {
    const mk = (rows: unknown[]) => ({
      findMany: jest
        .fn<Promise<unknown[]>, [{ where: Record<string, unknown> }]>()
        .mockResolvedValue(rows),
    });
    const department = mk([
      { id: 'd1', name: 'Haematology' },
      { id: 'd2', name: 'Immunology' },
    ]);
    const service = makeService();
    Object.assign(service, {
      prisma: {
        branch: mk([]),
        referralDoctor: mk([]),
        referralPanel: mk([]),
        department,
      },
    });
    const out = await service.getOptions('t1', 'b1');
    expect(out.departments).toEqual([
      { id: 'd1', name: 'Haematology' },
      { id: 'd2', name: 'Immunology' },
    ]);
    const where = department.findMany.mock.calls[0]![0].where;
    expect(where).toEqual({ tenantId: 't1', deletedAt: null });
  });

  it('needs an active branch', async () => {
    await expect(makeService().getOptions('t1', null)).rejects.toBeDefined();
  });
});

describe('department flow - the controller: the two dropdowns need no user', () => {
  function build() {
    const labReportService = {
      getLabTestOptions: jest.fn().mockResolvedValue({ data: [] }),
      getLabPanelOptions: jest.fn().mockResolvedValue({ data: [] }),
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
    return { controller, labReportService };
  }
  const profile = { profileKey: 'lab_technician', branchId: 'b1' };

  it('lab-test-options passes the tenant, the active branch and the query - nothing about the person', async () => {
    const { controller, labReportService } = build();
    const query = { search: 'cbc', page: 2, limit: 5 };
    await controller.getLabTestOptions('t1', profile, query);
    expect(labReportService.getLabTestOptions).toHaveBeenCalledWith(
      't1',
      'b1',
      query,
    );
  });

  it('lab-panel-options does the same', async () => {
    const { controller, labReportService } = build();
    const query = { search: 'liver' };
    await controller.getLabPanelOptions('t1', profile, query);
    expect(labReportService.getLabPanelOptions).toHaveBeenCalledWith(
      't1',
      'b1',
      query,
    );
  });
});

describe('department flow - opening one report (findByIdForViewer)', () => {
  function build() {
    const resolveDepartmentIds = jest.fn().mockResolvedValue(['d1']);
    const service = makeService();
    Object.assign(service, { userDepartmentScope: { resolveDepartmentIds } });
    return { service, resolveDepartmentIds };
  }

  it('a report that does not exist stays "not found" and costs no department lookup', async () => {
    const { service, resolveDepartmentIds } = build();
    jest
      .spyOn(service, 'findByIdForApi')
      .mockRejectedValue(new LabReportNotFoundException('r1'));
    await expect(
      service.findByIdForViewer('r1', 't1', 'b1', 'p1'),
    ).rejects.toBeInstanceOf(LabReportNotFoundException);
    expect(resolveDepartmentIds).not.toHaveBeenCalled();
  });

  it('a hidden report gives the SAME not-found as a missing one (nothing tells them apart)', async () => {
    const { service } = build();
    jest
      .spyOn(service, 'findByIdForApi')
      .mockResolvedValue({ id: 'r1', departmentId: 'other' } as never);
    await expect(
      service.findByIdForViewer('r1', 't1', 'b1', 'p1'),
    ).rejects.toMatchObject({ message: expect.any(String) as unknown });
    await expect(
      service.findByIdForViewer('r1', 't1', 'b1', 'p1'),
    ).rejects.toBeInstanceOf(LabReportNotFoundException);
  });

  it('a user in several departments opens a report in any of them', async () => {
    const { service, resolveDepartmentIds } = build();
    resolveDepartmentIds.mockResolvedValue(['d1', 'd2', 'd3']);
    const detail = { id: 'r1', departmentId: 'd3' };
    jest.spyOn(service, 'findByIdForApi').mockResolvedValue(detail as never);
    await expect(
      service.findByIdForViewer('r1', 't1', 'b1', 'p1'),
    ).resolves.toBe(detail);
  });

  it('the detail is loaded for the caller branch first and its department is the one judged', async () => {
    const { service } = build();
    const spy = jest
      .spyOn(service, 'findByIdForApi')
      .mockResolvedValue({ id: 'r1', departmentId: 'd1' } as never);
    await service.findByIdForViewer('r1', 't1', 'b9', 'p1');
    expect(spy).toHaveBeenCalledWith('r1', 't1', 'b9');
  });
});
