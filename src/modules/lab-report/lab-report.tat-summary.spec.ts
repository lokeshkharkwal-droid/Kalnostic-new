import { LabReportStatus, OrderStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import type { WorklistBranchScope } from './access/worklist-branch-scope';

const SINGLE_BRANCH: WorklistBranchScope = {
  rules: [{ branchId: 'b1', statuses: 'ALL' }],
};

/**
 * The TAT Analytics panel counts exactly what the worklist's Approved tab counts:
 * same filters, same branch/department scope, status Approved only (a Published or
 * Error Reported report is no longer "Approved").
 */
describe('LabReportService.getTatSummary', () => {
  const summarize = jest.fn().mockResolvedValue({ total: 0 });
  const resolveDepartmentIds = jest.fn().mockResolvedValue(['dept-1']);

  const service = new LabReportService(
    ...(Array(11).fill(undefined) as ConstructorParameters<
      typeof LabReportService
    >),
  );
  Object.assign(service, {
    tatService: { summarize },
    userDepartmentScope: { resolveDepartmentIds },
  });

  const run = async (filters: Record<string, unknown>) => {
    summarize.mockClear();
    await service.getTatSummary('t1', SINGLE_BRANCH, filters, 'p1');
    return (summarize.mock.calls[0] as [Record<string, unknown>])[0];
  };

  it('always selects status Approved, whatever status the tab sent', async () => {
    const where = await run({ status: LabReportStatus.PUBLISHED });
    expect(where.status).toBe(LabReportStatus.APPROVED);
  });

  it('uses the worklist filters (order date, department, search)', async () => {
    const where = (await run({
      dateFrom: '2026-10-06',
      dateTo: '2026-10-09',
      departmentId: 'd9',
    })) as {
      orderItem: {
        order: { orderDate: unknown };
        branchLabTest: { departmentId: string };
      };
    };
    expect(where.orderItem.order.orderDate).toEqual({
      gte: new Date('2026-10-06T00:00:00.000Z'),
      lte: new Date('2026-10-09T00:00:00.000Z'),
    });
    expect(where.orderItem.branchLabTest.departmentId).toBe('d9');
  });

  it('keeps the tenant, branch scope and department scope of the tab counts', async () => {
    const where = await run({});
    expect(resolveDepartmentIds).toHaveBeenCalledWith('t1', 'p1');
    expect(where).toMatchObject({
      tenantId: 't1',
      branchId: 'b1',
      deletedAt: null,
    });
    expect(JSON.stringify(where)).toContain('dept-1');
  });

  it('does not filter on approvedAt any more', async () => {
    const where = await run({ dateFrom: '2026-10-06' });
    expect(where.approvedAt).toBeUndefined();
  });

  it('leaves cancelled orders out, keeping any scope condition already on AND', async () => {
    const where = await run({});
    const and = where.AND as unknown[];
    expect(Array.isArray(and)).toBe(true);
    expect(and).toContainEqual({
      orderItem: { order: { status: { not: OrderStatus.CANCELLED } } },
    });
  });
});
