import { PDFDocument } from 'pdf-lib';
import { LabReportService } from './lab-report.service';
import { OrderReportsNotFoundException } from './exceptions/lab-report.exceptions';

const TENANT = 't1';

/** A one-page PDF so the merge step (pdf-lib) has something valid to load. */
async function onePagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage();
  return Buffer.from(await doc.save());
}

interface Setup {
  svc: LabReportService;
  findMany: jest.Mock;
  print: jest.SpyInstance<
    Promise<Buffer>,
    Parameters<LabReportService['print']>
  >;
}

/**
 * Builds the service without its DI graph — `printAllForOrder` only touches
 * `prisma.order/labReport`, the referral-credit gate and `print`.
 */
async function setup(
  order: { branchId: string | null } | null,
): Promise<Setup> {
  const findMany = jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    // the cancelled-order print check has its own spec (print-cancelled)
    assertReportOrderNotCancelledForPrint: jest
      .fn()
      .mockResolvedValue(undefined),
    assertOrderNotCancelledForPrint: jest.fn().mockResolvedValue(undefined),
    prisma: {
      order: { findFirst: jest.fn().mockResolvedValue(order) },
      labReport: { findMany },
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

const whereOf = (findMany: jest.Mock): Record<string, unknown> =>
  (findMany.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;

describe('print-all scope (order owner vs other branches)', () => {
  it('the order-owner branch prints every report on the order, any branch', async () => {
    const { svc, findMany, print } = await setup({ branchId: 'A' });
    await svc.printAllForOrder('o1', TENANT, 'A');
    const where = whereOf(findMany);
    expect(where).not.toHaveProperty('branchId');
    expect(where).toMatchObject({
      tenantId: TENANT,
      orderItem: { orderId: 'o1' },
    });
    // every report is read without a branch filter (allBranches = true)
    expect(print.mock.calls.map((c) => c[5])).toEqual([true, true]);
  });

  it('any other branch keeps its own-branch scope', async () => {
    const { svc, findMany, print } = await setup({ branchId: 'A' });
    await svc.printAllForOrder('o1', TENANT, 'B');
    expect(whereOf(findMany)).toMatchObject({ branchId: 'B' });
    expect(print.mock.calls.map((c) => c[5])).toEqual([false, false]);
  });

  it('an unknown order (or one with no branch) never widens the scope', async () => {
    for (const order of [null, { branchId: null }]) {
      const { svc, findMany } = await setup(order);
      await svc.printAllForOrder('o1', TENANT, 'B');
      expect(whereOf(findMany)).toMatchObject({ branchId: 'B' });
    }
  });

  it('an unrelated branch with no reports gets the same not-found as today', async () => {
    const { svc, findMany } = await setup({ branchId: 'A' });
    findMany.mockResolvedValue([]);
    await expect(svc.printAllForOrder('o1', TENANT, 'C')).rejects.toThrow(
      OrderReportsNotFoundException,
    );
  });

  it('keeps the order-item restriction for the owner too', async () => {
    const { svc, findMany } = await setup({ branchId: 'A' });
    await svc.printAllForOrder('o1', TENANT, 'A', undefined, ['i1']);
    expect(whereOf(findMany)).toMatchObject({
      orderItem: { orderId: 'o1' },
      orderItemId: { in: ['i1'] },
    });
  });
});
