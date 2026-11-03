import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import type { WorklistBranchScope } from './access/worklist-branch-scope';

type Where = Record<string, unknown>;

/**
 * Regression coverage for department-wise visibility on the Technician Reporting
 * worklist (`/technician/reporting` → `/lab-reports`). The rule must behave
 * exactly like Accession's `/accession/in-house-orders`: filter on the report's
 * OWN denormalized department (stamped per test at creation), never on a join
 * through `orderItem.branchLabTest` / `branchLabPanel` — which resolved a panel
 * member report to the PANEL's single department and broke visibility for the
 * member test's own department.
 */

/** `buildListWhere` is pure — call it without the service's DI graph. */
function whereFor(scopeIds: string[], filters = {}): Where {
  const svc = Object.create(LabReportService.prototype) as unknown as {
    buildListWhere: (
      tenantId: string,
      scope: WorklistBranchScope,
      filters: object,
      scopeIds: string[],
    ) => Where;
  };
  return svc.buildListWhere(
    't1',
    { rules: [{ branchId: 'A', statuses: 'ALL' }] },
    filters,
    scopeIds,
  );
}

/** The not-yet-transferred ("line") visibility clause the worklist applies. */
function lineClause(scopeIds: string[]): Where {
  const held = (
    (whereFor(scopeIds).AND as Array<{ OR: Where[] }>)[0]!.OR[0] as {
      OR: Where[];
    }
  ).OR;
  return held[0] as Where;
}

describe('Reporting worklist department visibility → query', () => {
  it('filters directly on LabReport.departmentId — no join through the order item', () => {
    const line = lineClause(['d1', 'd2']);
    // The clause carries the report line department directly; it must NOT reach
    // into orderItem.branchLabTest / branchLabPanel (the old, panel-broken join).
    expect(line.performingBranchLabTestId).toBeNull();
    expect(line.OR).toEqual([
      { departmentId: null },
      { departmentId: { in: ['d1', 'd2'] } },
    ]);
    expect(line.orderItem).toBeUndefined();
    expect(JSON.stringify(line)).not.toContain('branchLabTest');
    expect(JSON.stringify(line)).not.toContain('branchLabPanel');
  });

  it('a user with NO department is UNRESTRICTED — sees every report (no department constraint), like Accession In-House', () => {
    const line = lineClause([]);
    // Empty scope adds no department predicate: the line clause carries only the
    // branch-structure key, not a `departmentId` filter.
    expect(line).toEqual({
      performingBranchLabTestId: null,
    });
    expect(line.departmentId).toBeUndefined();
  });

  it('the explicit Department filter matches the report line department (works for panel members too)', () => {
    // Previously joined orderItem.branchLabTest.departmentId, which is null for a
    // panel order item, so a panel member in that department never matched.
    const w = whereFor(['d1'], { departmentId: 'd1' });
    expect(w.departmentId).toBe('d1');
    const orderItem = w.orderItem as Where;
    expect(orderItem.branchLabTest).toBeUndefined();
  });
});

/**
 * The denormalization itself: a report must be stamped with ITS OWN test's
 * department at creation — the member test's for a panel member, the standalone
 * test's otherwise — mirroring OrderSample.departmentId. This is what makes the
 * direct filter above correct for panels.
 */
describe('createReportForAcceptedItem stamps the report line department', () => {
  type CreatedReport = {
    departmentId: string | null;
    memberBranchLabTestId: string | null;
  };

  async function run(
    orderItem: Record<string, unknown>,
    opts: {
      panelMembers?: Array<{
        id: string;
        sourceLabTestId: string | null;
        departmentId: string | null;
      }>;
      labTestDeptById?: Record<string, string | null>;
    } = {},
  ): Promise<CreatedReport[]> {
    const created: CreatedReport[] = [];
    const members = opts.panelMembers ?? [];
    const tx = {
      orderItem: { findFirst: jest.fn().mockResolvedValue(orderItem) },
      labReport: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation((args: { data: CreatedReport }) => {
            created.push({
              departmentId: args.data.departmentId,
              memberBranchLabTestId: args.data.memberBranchLabTestId,
            });
            return Promise.resolve({ id: `report-${created.length}` });
          }),
      },
      labReportHistory: { create: jest.fn().mockResolvedValue({}) },
      branchLabPanelTest: {
        findMany: jest
          .fn()
          .mockResolvedValue(members.map((m) => ({ branchLabTestId: m.id }))),
      },
      branchLabTest: {
        findMany: jest.fn().mockResolvedValue(members),
      },
      labTest: {
        findFirst: jest
          .fn()
          .mockImplementation((args: { where: { id: string } }) =>
            Promise.resolve({
              departmentId: opts.labTestDeptById?.[args.where.id] ?? null,
            }),
          ),
      },
    };
    const svc = Object.create(LabReportService.prototype) as unknown as {
      createReportForAcceptedItem: (
        tx: unknown,
        tenantId: string,
        orderItemId: string,
      ) => Promise<void>;
    };
    await svc.createReportForAcceptedItem(tx, 't1', 'oi1');
    return created;
  }

  it('an INDIVIDUAL test report takes the order line test department', async () => {
    const created = await run({
      id: 'oi1',
      branchId: 'A',
      branchLabPanelId: null,
      outsourceCenterId: null,
      collectedBy: 'u1',
      branchLabTest: { sourceLabTestId: 'lt-hema', departmentId: 'HEMATOLOGY' },
    });
    expect(created).toEqual([
      { departmentId: 'HEMATOLOGY', memberBranchLabTestId: null },
    ]);
  });

  it('a PANEL expands into per-member reports, each stamped with its MEMBER test department (not the panel department)', async () => {
    // Panel "Thyroid Profile" sits in ENDOCRINE, but its members are BIOCHEMISTRY.
    // The reports must carry BIOCHEMISTRY so biochem technicians see them.
    const created = await run(
      {
        id: 'oi1',
        branchId: 'A',
        branchLabPanelId: 'panel-thyroid',
        branchLabPanel: { departmentId: 'ENDOCRINE' },
        branchLabTest: null,
        outsourceCenterId: null,
        collectedBy: 'u1',
      },
      {
        panelMembers: [
          {
            id: 'm-tsh',
            sourceLabTestId: 'lt-tsh',
            departmentId: 'BIOCHEMISTRY',
          },
          {
            id: 'm-t3',
            sourceLabTestId: 'lt-t3',
            departmentId: 'BIOCHEMISTRY',
          },
        ],
      },
    );
    expect(created).toEqual([
      { departmentId: 'BIOCHEMISTRY', memberBranchLabTestId: 'm-tsh' },
      { departmentId: 'BIOCHEMISTRY', memberBranchLabTestId: 'm-t3' },
    ]);
    // Never the panel's own department.
    expect(created.map((r) => r.departmentId)).not.toContain('ENDOCRINE');
  });

  it('falls back to the source Master Data test department when the member branch entry has none', async () => {
    const created = await run(
      {
        id: 'oi1',
        branchId: 'A',
        branchLabPanelId: 'panel-x',
        branchLabPanel: { departmentId: null },
        branchLabTest: null,
        outsourceCenterId: null,
        collectedBy: 'u1',
      },
      {
        panelMembers: [
          { id: 'm1', sourceLabTestId: 'lt-src', departmentId: null },
        ],
        labTestDeptById: { 'lt-src': 'MICROBIOLOGY' },
      },
    );
    expect(created).toEqual([
      { departmentId: 'MICROBIOLOGY', memberBranchLabTestId: 'm1' },
    ]);
  });

  it('leaves departmentId NULL (visible to everyone) when neither the entry nor source resolves one', async () => {
    const created = await run({
      id: 'oi1',
      branchId: 'A',
      branchLabPanelId: null,
      outsourceCenterId: null,
      collectedBy: 'u1',
      branchLabTest: { sourceLabTestId: null, departmentId: null },
    });
    expect(created).toEqual([
      { departmentId: null, memberBranchLabTestId: null },
    ]);
  });

  it('still creates reports in PENDING status (behaviour otherwise unchanged)', async () => {
    const tx = {
      orderItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'oi1',
          branchId: 'A',
          branchLabPanelId: null,
          outsourceCenterId: null,
          collectedBy: 'u1',
          branchLabTest: { sourceLabTestId: 'lt', departmentId: 'D' },
        }),
      },
      labReport: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn<
            Promise<{ id: string }>,
            [{ data: { status: LabReportStatus } }]
          >()
          .mockResolvedValue({ id: 'r1' }),
      },
      labReportHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const svc = Object.create(LabReportService.prototype) as unknown as {
      createReportForAcceptedItem: (
        tx: unknown,
        tenantId: string,
        orderItemId: string,
      ) => Promise<void>;
    };
    await svc.createReportForAcceptedItem(tx, 't1', 'oi1');
    const firstCall = tx.labReport.create.mock.calls[0];
    expect(firstCall?.[0].data.status).toBe(LabReportStatus.PENDING);
  });
});
