import { LabReportStatus } from '@prisma/client';
import type { WorklistBranchScope } from './access/worklist-branch-scope';
import { CriticalAlertService } from './critical-alert.service';
import { DeltaCheckService } from './delta-check.service';
import { OutOfRangeService } from './out-of-range.service';
import { ReRunService } from './re-run.service';
import { ScheduledTestService } from './scheduled-test.service';

type Where = Record<string, unknown>;

/**
 * Every special worklist (one per Technician tab) must apply the SAME per-branch
 * rule as the main worklist: a branch contributes only the report statuses ITS
 * permissions grant, and an unauthorised branch contributes nothing.
 */
const CASES: Array<{
  name: string;
  Service: { prototype: object };
  model: string;
}> = [
  {
    name: 'Critical Alerts',
    Service: CriticalAlertService,
    model: 'criticalAlert',
  },
  { name: 'Re-run', Service: ReRunService, model: 'reRunRequest' },
  { name: 'Out of Range', Service: OutOfRangeService, model: 'outOfRangeFlag' },
  { name: 'Delta Check', Service: DeltaCheckService, model: 'deltaCheck' },
  {
    name: 'Scheduled Tests',
    Service: ScheduledTestService,
    model: 'scheduledTest',
  },
];

async function listWhere(
  c: (typeof CASES)[number],
  scope: WorklistBranchScope,
): Promise<Where> {
  const findMany = jest.fn().mockResolvedValue([]);
  const svc = Object.create(c.Service.prototype) as {
    findAll: (tenantId: string, scope: WorklistBranchScope) => Promise<unknown>;
  };
  Object.assign(svc, {
    prisma: new Proxy(
      { [c.model]: { findMany } },
      {
        get: (t, k: string) =>
          k in t
            ? (t as Record<string, unknown>)[k]
            : { findMany: jest.fn().mockResolvedValue([]) },
      },
    ),
  });
  await svc.findAll('t1', scope);
  return (findMany.mock.calls[0] as [{ where: Where }])[0].where;
}

describe.each(CASES)('$name worklist — branch scope', (c) => {
  it('own branch only: every row of that branch, nothing else', async () => {
    const w = await listWhere(c, {
      rules: [{ branchId: 'A', statuses: 'ALL' }],
    });
    expect(w).toMatchObject({
      tenantId: 't1',
      deletedAt: null,
      OR: [{ branchId: 'A' }],
    });
  });

  it('All Branches: each branch keeps its own visible statuses (permissions not merged)', async () => {
    const w = await listWhere(c, {
      rules: [
        { branchId: 'A', statuses: 'ALL' },
        { branchId: 'B', statuses: new Set([LabReportStatus.PENDING]) },
        { branchId: 'C', statuses: new Set([LabReportStatus.APPROVED]) },
      ],
    });
    expect(w.OR).toEqual([
      { branchId: 'A' },
      {
        branchId: 'B',
        labReport: { status: { in: [LabReportStatus.PENDING] } },
      },
      {
        branchId: 'C',
        labReport: { status: { in: [LabReportStatus.APPROVED] } },
      },
    ]);
  });

  it('a branch that grants no statuses is excluded', async () => {
    const w = await listWhere(c, {
      rules: [
        { branchId: 'A', statuses: 'ALL' },
        { branchId: 'D', statuses: new Set() },
      ],
    });
    expect(w.OR).toEqual([{ branchId: 'A' }]);
  });

  it('an empty scope matches nothing', async () => {
    const w = await listWhere(c, { rules: [] });
    expect(w.OR).toEqual([]);
  });
});
