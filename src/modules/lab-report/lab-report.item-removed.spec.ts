import { LabReportStatus, OrderStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import {
  LabReportItemRemovedException,
  LabReportOrderCancelledException,
  LabReportPrintItemRemovedException,
} from './exceptions/lab-report.exceptions';
import { assertReportWritable } from './utils/sent-out-report.util';
import { toWorklistRow, LabReportListRow } from './entities/lab-report.entity';
import { ClinicalEventListener } from '../communication/clinical-event.listener';
import { AccessionDashboardService } from '../accession/accession-dashboard.service';
import { ReferralUsageService } from '../referral-usage/referral-usage.service';

/**
 * "Test removed from order": the test's report is kept but frozen. Removal is
 * derived from the order item's `deletedAt`. Report writes and prints are refused,
 * the worklist row carries `itemRemoved`, and order-level aggregates ignore it.
 */

describe('assertReportWritable - a removed test', () => {
  const makeDb = (
    report: Record<string, unknown> | null,
    cancelled = false,
  ) => ({
    labReport: {
      // 1st probe: is the order cancelled?  2nd: the report itself.
      findFirst: jest.fn((arg: { where: { orderItem?: unknown } }) =>
        Promise.resolve(
          arg.where.orderItem ? (cancelled ? { id: 'r1' } : null) : report,
        ),
      ),
    },
    orderSampleTest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  });
  const base = {
    branchId: 'B',
    orderItemId: 'i1',
    memberBranchLabTestId: null,
    labTestId: 'lt1',
  };

  it('refuses with 409 LAB_REPORT_ITEM_REMOVED', async () => {
    const db = makeDb({
      ...base,
      orderItem: { deletedAt: new Date('2026-10-01') },
    });
    const err = await assertReportWritable(db as never, 't1', 'r1').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LabReportItemRemovedException);
    expect(err).toMatchObject({
      errorCode: 'LAB_REPORT_ITEM_REMOVED',
      status: 409,
    });
    // refused before the sent-out / awaiting-sample probes
    expect(db.orderSampleTest.findFirst).not.toHaveBeenCalled();
  });

  it('lets a report of a live test through', async () => {
    const db = makeDb({ ...base, orderItem: { deletedAt: null } });
    await expect(
      assertReportWritable(db as never, 't1', 'r1'),
    ).resolves.toBeUndefined();
  });

  it('a cancelled order is still reported as cancelled first', async () => {
    const db = makeDb(
      { ...base, orderItem: { deletedAt: new Date('2026-10-01') } },
      true,
    );
    await expect(
      assertReportWritable(db as never, 't1', 'r1'),
    ).rejects.toBeInstanceOf(LabReportOrderCancelledException);
  });
});

describe('LabReportService - printing a removed test', () => {
  const build = (removed: boolean) => {
    const prisma = {
      labReport: {
        findFirst: jest
          .fn()
          // 1st: cancelled-order probe -> not cancelled; 2nd: removed probe
          .mockImplementation(
            (arg: {
              where: { orderItem?: { deletedAt?: unknown; order?: unknown } };
            }) =>
              Promise.resolve(
                arg.where.orderItem?.deletedAt && removed ? { id: 'r1' } : null,
              ),
          ),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      prisma,
      referralCredit: {
        assertReportAccessAllowedByReportId: jest
          .fn()
          .mockResolvedValue(undefined),
        assertReportAccessAllowedByOrderId: jest
          .fn()
          .mockResolvedValue(undefined),
      },
      assertOrderNotCancelledForPrint: jest.fn().mockResolvedValue(undefined),
      requireBranch: (b: string) => b,
      canPrintWholeOrder: jest.fn().mockResolvedValue(true),
      // anything past the removed check is a sentinel: proves the print went on
      ownsReportsOrder: jest.fn().mockRejectedValue(new Error('PAST_CHECK')),
    });
    return { svc, prisma };
  };

  it('single print is refused 409 LAB_REPORT_PRINT_ITEM_REMOVED', async () => {
    const { svc } = build(true);
    const err = await svc.print('r1', 't1', 'A').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LabReportPrintItemRemovedException);
    expect(err).toMatchObject({ errorCode: 'LAB_REPORT_PRINT_ITEM_REMOVED' });
  });

  it('a report of a live test goes on with the normal print', async () => {
    const { svc } = build(false);
    await expect(svc.print('r1', 't1', 'A')).rejects.toThrow('PAST_CHECK');
  });

  it('print-all leaves a removed test out (its reports are never selected)', async () => {
    const { svc, prisma } = build(false);
    await svc.printAllForOrder('o1', 't1', 'A').catch(() => undefined);
    const where = (
      (prisma.labReport.findMany.mock.calls as unknown[][])[0]![0] as {
        where: { orderItem: unknown };
      }
    ).where;
    expect(where.orderItem).toEqual({ orderId: 'o1', deletedAt: null });
  });
});

describe('toWorklistRow - itemRemoved', () => {
  const row = (deletedAt: Date | null) =>
    ({
      id: 'r1',
      status: LabReportStatus.PENDING,
      isUrgent: false,
      isOutsourced: false,
      createdAt: new Date(),
      isLocked: false,
      branchId: 'B',
      labTestId: null,
      memberBranchLabTestId: null,
      orderItemId: 'i1',
      orderItem: {
        deletedAt,
        order: null,
        branchLabTest: null,
        branchLabPanel: null,
        direct: 'X',
      },
    }) as unknown as LabReportListRow;

  it('is true when the order item was soft-deleted, false otherwise', () => {
    expect(toWorklistRow(row(new Date())).itemRemoved).toBe(true);
    expect(toWorklistRow(row(null)).itemRemoved).toBe(false);
  });
});

describe('order-level aggregates ignore a removed test', () => {
  it('order-complete notification only looks at live items', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { labReport: { findMany }, order: { updateMany: jest.fn() } };
    const listener = Object.create(
      ClinicalEventListener.prototype,
    ) as ClinicalEventListener;
    Object.assign(listener, {
      prisma: {
        withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx),
      },
      logger: { error: jest.fn() },
    });
    await (
      listener as unknown as {
        maybeNotifyOrderCompleted: (...a: unknown[]) => Promise<void>;
      }
    ).maybeNotifyOrderCompleted('t1', 'A', 'o1', 'p1', 'ORD-1');
    expect((findMany.mock.calls as unknown[][])[0]![0]).toMatchObject({
      where: { orderItem: { orderId: 'o1', deletedAt: null } },
    });
  });

  it('order-complete: a frozen Pending report does not stop the order completing', async () => {
    // The only report left after the live-item filter is PUBLISHED -> claim + notify.
    const findMany = jest
      .fn()
      .mockResolvedValue([{ status: LabReportStatus.PUBLISHED }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { labReport: { findMany }, order: { updateMany } };
    const dispatchToPatient = jest.fn().mockResolvedValue(undefined);
    const listener = Object.create(
      ClinicalEventListener.prototype,
    ) as ClinicalEventListener;
    Object.assign(listener, {
      prisma: {
        withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx),
      },
      auto: { dispatchToPatient },
      buildOrderVariables: jest.fn().mockResolvedValue({}),
      logger: { error: jest.fn() },
    });
    await (
      listener as unknown as {
        maybeNotifyOrderCompleted: (...a: unknown[]) => Promise<void>;
      }
    ).maybeNotifyOrderCompleted('t1', 'A', 'o1', 'p1', 'ORD-1');
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(dispatchToPatient).toHaveBeenCalledTimes(1);
  });

  it('dashboard counts leave out item-removed samples', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const svc = new AccessionDashboardService(
      { orderSample: { groupBy } } as never,
      {} as never,
    );
    await svc.getOrderStatusOverview('t1', 'A');
    const where = (groupBy.mock.calls as unknown[][])[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(where.where.order).toEqual({
      status: { not: OrderStatus.CANCELLED },
    });
    expect(where.where.NOT).toBeDefined();
  });

  it('referral "in use" ignores a removed test (report + sample branch)', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const svc = new ReferralUsageService({ order: { count } } as never);
    await svc.hasActiveOrder('t1', 'referralPanelId', 'ref1');
    type Branches = {
      orderSamples: { some: { NOT?: unknown } };
      items: { some: { deletedAt: null } };
    };
    const where = (
      (count.mock.calls as unknown[][])[0]![0] as {
        where: { OR: Branches[] };
      }
    ).where;
    expect(where.OR[0]!.orderSamples.some.NOT).toBeDefined();
    expect(where.OR[1]!.items.some.deletedAt).toBeNull();
  });
});
