import { OrderStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { LabReportPrintOrderCancelledException } from './exceptions/lab-report.exceptions';

/** A cancelled order's reports cannot be printed - single or whole order. */
describe('LabReportService - printing a cancelled order', () => {
  const build = (cancelled: boolean) => {
    const prisma = {
      labReport: {
        findFirst: jest.fn().mockResolvedValue(cancelled ? { id: 'r1' } : null),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue(cancelled ? { id: 'o1' } : null),
      },
    };
    const referralCredit = {
      assertReportAccessAllowedByReportId: jest
        .fn()
        .mockResolvedValue(undefined),
      assertReportAccessAllowedByOrderId: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, { prisma, referralCredit });
    // anything past the cancelled check is a sentinel: proves the print went on
    const next = jest.fn().mockRejectedValue(new Error('PAST_CANCEL_CHECK'));
    (svc as unknown as Record<string, unknown>).ownsReportsOrder = next;
    (svc as unknown as Record<string, unknown>).requireBranch = (b: string) =>
      b;
    (svc as unknown as Record<string, unknown>).canPrintWholeOrder = next;
    return { svc, prisma, next };
  };

  it("single print is refused when the report's order is cancelled", async () => {
    const { svc, prisma, next } = build(true);
    await expect(svc.print('r1', 't1', 'A')).rejects.toBeInstanceOf(
      LabReportPrintOrderCancelledException,
    );
    expect(next).not.toHaveBeenCalled();
    expect(prisma.labReport.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'r1',
        tenantId: 't1',
        deletedAt: null,
        orderItem: { order: { status: OrderStatus.CANCELLED } },
      },
      select: { id: true },
    });
  });

  it('whole-order print is refused when the order is cancelled', async () => {
    const { svc, prisma, next } = build(true);
    await expect(svc.printAllForOrder('o1', 't1', 'A')).rejects.toBeInstanceOf(
      LabReportPrintOrderCancelledException,
    );
    expect(next).not.toHaveBeenCalled();
    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: { id: 'o1', tenantId: 't1', status: OrderStatus.CANCELLED },
      select: { id: true },
    });
  });

  it('carries the 409 code the screen can show', async () => {
    const { svc } = build(true);
    await expect(svc.print('r1', 't1', 'A')).rejects.toMatchObject({
      response: { error: { code: 'LAB_REPORT_PRINT_ORDER_CANCELLED' } },
    });
  });

  it('a live order goes on with the normal print', async () => {
    const { svc, next } = build(false);
    await expect(svc.print('r1', 't1', 'A')).rejects.toThrow(
      'PAST_CANCEL_CHECK',
    );
    expect(next).toHaveBeenCalled();
    const b = build(false);
    await expect(b.svc.printAllForOrder('o1', 't1', 'A')).rejects.toThrow(
      'PAST_CANCEL_CHECK',
    );
  });
});
