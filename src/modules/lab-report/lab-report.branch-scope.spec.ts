import { LabReportStatus } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { LabReportService } from './lab-report.service';
import type { WorklistBranchScope } from './access/worklist-branch-scope';

type Where = Record<string, unknown>;

/** `buildListWhere` is pure — call it without the service's DI graph. */
function whereFor(scope: WorklistBranchScope, filters = {}): Where {
  const svc = Object.create(LabReportService.prototype) as unknown as {
    buildListWhere: (
      tenantId: string,
      scope: WorklistBranchScope,
      filters: object,
      scopeIds: string[],
    ) => Where;
  };
  return svc.buildListWhere('t1', scope, filters, []);
}

describe('worklist branch scope → query', () => {
  it('(8) own branch only keeps the plain branchId equality it always had', () => {
    const w = whereFor({ rules: [{ branchId: 'A', statuses: 'ALL' }] });
    expect(w.branchId).toBe('A');
    expect(w.AND).toBeUndefined();
  });

  it('(4) several branches become an OR of per-branch rules, one per branch', () => {
    const w = whereFor({
      rules: [
        { branchId: 'A', statuses: 'ALL' },
        {
          branchId: 'B',
          statuses: new Set([LabReportStatus.PENDING, LabReportStatus.SAVED]),
        },
      ],
    });
    expect(w.branchId).toBeUndefined();
    expect(w.AND).toEqual([
      {
        OR: [
          { branchId: 'A' },
          {
            branchId: 'B',
            status: { in: [LabReportStatus.PENDING, LabReportStatus.SAVED] },
          },
        ],
      },
    ]);
  });

  it("(9) a branch restricted to some statuses is never given the other branch's statuses", () => {
    const w = whereFor({
      rules: [
        { branchId: 'B', statuses: new Set([LabReportStatus.PENDING]) },
        { branchId: 'C', statuses: new Set([LabReportStatus.APPROVED]) },
      ],
    });
    const or = (w.AND as Array<{ OR: Where[] }>)[0]?.OR ?? [];
    expect(or).toEqual([
      { branchId: 'B', status: { in: [LabReportStatus.PENDING] } },
      { branchId: 'C', status: { in: [LabReportStatus.APPROVED] } },
    ]);
  });

  it('a branch that grants no statuses at all contributes nothing', () => {
    const w = whereFor({
      rules: [
        { branchId: 'A', statuses: 'ALL' },
        { branchId: 'D', statuses: new Set() },
      ],
    });
    expect(w.branchId).toBe('A'); // collapses to the single usable branch
  });

  it('a scope with no usable branch matches nothing (never falls back to everything)', () => {
    const w = whereFor({ rules: [{ branchId: 'D', statuses: new Set() }] });
    expect(w.branchId).toEqual({ in: [] });
  });

  it('composes with the status tab filter (status AND the branch rules)', () => {
    const w = whereFor(
      {
        rules: [
          { branchId: 'A', statuses: 'ALL' },
          { branchId: 'B', statuses: new Set([LabReportStatus.SAVED]) },
        ],
      },
      { status: LabReportStatus.APPROVED },
    );
    // the tab narrows to Approved; B's rule only allows Saved, so B adds nothing
    expect(w.status).toBe(LabReportStatus.APPROVED);
    expect((w.AND as Array<{ OR: Where[] }>)[0]?.OR).toHaveLength(2);
  });
});

describe('Print All across authorised branches', () => {
  async function onePagePdf(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.addPage();
    return Buffer.from(await doc.save());
  }

  async function setup(
    rows: Array<{ id: string; branchId: string | null }>,
    orderOwnerBranch = 'ORDER-OWNER',
  ) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      // the cancelled-order print check has its own spec (print-cancelled)
      assertReportOrderNotCancelledForPrint: jest
        .fn()
        .mockResolvedValue(undefined),
      assertOrderNotCancelledForPrint: jest.fn().mockResolvedValue(undefined),
      prisma: {
        labReport: { findMany },
        order: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ branchId: orderOwnerBranch }),
        },
      },
      referralCredit: {
        assertReportAccessAllowedByOrderId: jest
          .fn()
          .mockResolvedValue(undefined),
      },
    });
    const pdf = await onePagePdf();
    const print = jest
      .spyOn(svc, 'print')
      .mockImplementation(() => Promise.resolve(pdf));
    return { svc, findMany, print };
  }

  it("prints the order's reports from every authorised branch, each through ITS OWN branch", async () => {
    const { svc, findMany, print } = await setup([
      { id: 'r1', branchId: 'A' },
      { id: 'r2', branchId: 'B' },
    ]);
    await svc.printAllForOrder('o1', 't1', 'A', undefined, undefined, {
      rules: [
        { branchId: 'A', statuses: 'ALL' },
        { branchId: 'B', statuses: new Set([LabReportStatus.SAVED]) },
      ],
    });
    const where = (findMany.mock.calls[0] as [{ where: Where }])[0].where;
    expect(where.AND).toBeDefined(); // the per-branch rules, not "own branch only"
    expect(where.branchId).toBeUndefined();
    // r2 belongs to B -> rendered with B, not with the caller's branch A
    expect(print.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ['r1', 'A'],
      ['r2', 'B'],
    ]);
  });

  it('the order-owner branch prints every report on the order, whatever its scope', async () => {
    const { svc, findMany, print } = await setup(
      [
        { id: 'r1', branchId: 'A' },
        { id: 'r2', branchId: 'B' },
      ],
      'A', // the caller's branch owns the order
    );
    await svc.printAllForOrder('o1', 't1', 'A', undefined, undefined, {
      rules: [{ branchId: 'A', statuses: 'ALL' }],
    });
    const where = (findMany.mock.calls[0] as [{ where: Where }])[0].where;
    expect(where.branchId).toBeUndefined(); // no branch restriction at all
    expect(where.AND).toBeUndefined();
    // each report is still rendered through its own branch, read across branches
    expect(print.mock.calls.map((c) => [c[0], c[2], c[5]])).toEqual([
      ['r1', 'A', true],
      ['r2', 'B', true],
    ]);
  });

  it("without a scope (the share flows) it stays on the caller's own branch", async () => {
    const { svc, findMany } = await setup([{ id: 'r1', branchId: 'A' }]);
    await svc.printAllForOrder('o1', 't1', 'A');
    const where = (findMany.mock.calls[0] as [{ where: Where }])[0].where;
    expect(where.branchId).toBe('A');
    expect(where.AND).toBeUndefined();
  });
});
