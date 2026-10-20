import { LabReportService } from './lab-report.service';
import { LabReportAttachmentService } from './lab-report-attachment.service';
import { InventoryUsageService } from './inventory-usage.service';
import { TatAdjustmentService } from './tat-adjustment.service';
import { CriticalAlertService } from './critical-alert.service';
import { DeltaCheckService } from './delta-check.service';
import { OutOfRangeService } from './out-of-range.service';
import { ReRunService } from './re-run.service';
import { ScheduledTestService } from './scheduled-test.service';
import {
  LabReportNotFoundException,
  LabReportSentOutException,
  WorklistEntryNotFoundException,
} from './exceptions/lab-report.exceptions';

/**
 * A report whose sample was sent to another branch stays VISIBLE to its holder
 * but is view-only until the transfer is received or returned. Reads must work,
 * every write must refuse with the clear "sent out" error.
 */
const REPORT = {
  id: 'r1',
  branchId: 'A',
  orderItemId: 'item1',
  memberBranchLabTestId: null,
  labTestId: 'lt1',
  isLocked: false,
};

/** A prisma stand-in where `sentOut` decides whether the holder's sample is SENT_INTERNAL. */
function prismaWith(opts: { sentOut: boolean }) {
  return {
    labReport: {
      // The "is the order cancelled?" probe filters on orderItem.order: none here.
      findFirst: jest.fn((arg?: { where?: { orderItem?: unknown } }) =>
        Promise.resolve(arg?.where?.orderItem ? null : REPORT),
      ),
    },
    orderSampleTest: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.sentOut ? { id: 'link' } : { id: 'link2' }),
      // the "awaiting its sample" rule: no linked sample, so it does not apply
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

/**
 * `isReportSentOut` asks for a sent link by filtering on status SENT_INTERNAL, so
 * the mock answers by that filter: found only when the caller asked for it.
 */
function sentOutPrisma(sentOut: boolean) {
  const base = prismaWith({ sentOut });
  base.orderSampleTest.findFirst = jest.fn((arg: unknown) => {
    const wantsSent = JSON.stringify(arg).includes('SENT_INTERNAL');
    return Promise.resolve(
      wantsSent ? (sentOut ? { id: 'x' } : null) : { id: 'y' },
    );
  });
  return base;
}

describe('LabReportService.requireReport - the view-only lock applies to writes only', () => {
  function call(sentOut: boolean, forRead?: boolean) {
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, { prisma: sentOutPrisma(sentOut) });
    return (
      svc as unknown as {
        requireReport: (
          id: string,
          t: string,
          b: string,
          o?: { forRead?: boolean },
        ) => Promise<unknown>;
      }
    ).requireReport('r1', 't1', 'A', forRead ? { forRead: true } : undefined);
  }

  it('a normal report can be worked on', async () => {
    await expect(call(false)).resolves.toBeDefined();
  });

  it('a sent-out report refuses a write with the clear view-only error', async () => {
    await expect(call(true)).rejects.toBeInstanceOf(LabReportSentOutException);
  });

  it('...but the same report can still be READ', async () => {
    await expect(call(true, true)).resolves.toBeDefined();
  });

  it('a report in another branch is simply not found, read or write', async () => {
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      prisma: { labReport: { findFirst: jest.fn().mockResolvedValue(null) } },
    });
    await expect(
      (
        svc as unknown as {
          requireReport: (...a: unknown[]) => Promise<unknown>;
        }
      ).requireReport('r1', 't1', 'B', { forRead: true }),
    ).rejects.toBeInstanceOf(LabReportNotFoundException);
  });
});

describe('LabReportService.getHistory - a sent-out report can be read', () => {
  it('does not consult the sent-out lock at all', async () => {
    const prisma = {
      ...sentOutPrisma(true),
      labReportHistory: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      prisma,
      enrichActorNames: jest.fn().mockResolvedValue([]),
    });
    await expect(svc.getHistory('r1', 't1', 'A')).resolves.toEqual([]);
    expect(prisma.orderSampleTest.findFirst).not.toHaveBeenCalled();
  });
});

describe('the small report services: reads open, writes locked', () => {
  const attachment = () =>
    new LabReportAttachmentService(sentOutPrisma(true) as never);
  const inventory = () =>
    new InventoryUsageService(sentOutPrisma(true) as never);
  const tat = () => new TatAdjustmentService(sentOutPrisma(true) as never);

  it('attachments: list works, add and remove are refused', async () => {
    const svc = attachment();
    (
      svc as unknown as { prisma: Record<string, unknown> }
    ).prisma.labReportAttachment = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    await expect(svc.listForReport('r1', 't1', 'A')).resolves.toEqual([]);
    await expect(
      svc.addAttachment('r1', 't1', 'A', {} as never, 'p1'),
    ).rejects.toBeInstanceOf(LabReportSentOutException);
    await expect(svc.remove('r1', 'att1', 't1', 'A')).rejects.toBeInstanceOf(
      LabReportSentOutException,
    );
  });

  it('inventory usage: list works, create is refused', async () => {
    const svc = inventory();
    (
      svc as unknown as { prisma: Record<string, unknown> }
    ).prisma.labReportInventoryUsage = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    await expect(svc.findAll('r1', 't1', 'A')).resolves.toBeDefined();
    await expect(
      svc.create('r1', 't1', 'A', {} as never),
    ).rejects.toBeInstanceOf(LabReportSentOutException);
  });

  it('TAT adjustments: list works; create AND DELETE are refused', async () => {
    const svc = tat();
    const prisma = (svc as unknown as { prisma: Record<string, unknown> })
      .prisma;
    prisma.tatAdjustment = {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'adj1' }),
      update: jest.fn(),
    };
    prisma.person = { findMany: jest.fn().mockResolvedValue([]) };
    await expect(svc.findAll('r1', 't1', 'A')).resolves.toBeDefined();
    await expect(
      svc.create('r1', 't1', 'A', 'p1', {} as never),
    ).rejects.toBeInstanceOf(LabReportSentOutException);
    // delete used to skip the report entirely - it must be refused like the rest
    await expect(svc.remove('r1', 'adj1', 't1', 'A')).rejects.toBeInstanceOf(
      LabReportSentOutException,
    );
    expect(
      (prisma.tatAdjustment as { update: jest.Mock }).update,
    ).not.toHaveBeenCalled();
  });

  it('TAT adjustments: deleting an adjustment on a report in another branch is not found', async () => {
    const svc = new TatAdjustmentService({
      labReport: { findFirst: jest.fn().mockResolvedValue(null) },
    } as never);
    await expect(svc.remove('r1', 'adj1', 't1', 'B')).rejects.toBeInstanceOf(
      LabReportNotFoundException,
    );
  });
});

/**
 * The five worklist-row services update a row by ITS id. The row keeps the branch
 * it was raised at, which goes stale once the report is re-homed, so the lookup
 * must go through the REPORT's branch.
 */
describe.each([
  {
    name: 'critical alert',
    Service: CriticalAlertService,
    model: 'criticalAlert',
    call: (s: CriticalAlertService) =>
      s.updateStatus('e1', 't1', 'A', 'p1', { status: 'REVIEWED' } as never),
  },
  {
    name: 'delta check',
    Service: DeltaCheckService,
    model: 'deltaCheck',
    call: (s: DeltaCheckService) =>
      s.updateStatus('e1', 't1', 'A', 'p1', { status: 'REVIEWED' } as never),
  },
  {
    name: 'out of range',
    Service: OutOfRangeService,
    model: 'outOfRangeFlag',
    call: (s: OutOfRangeService) =>
      s.updateStatus('e1', 't1', 'A', 'p1', { status: 'REVIEWED' } as never),
  },
  {
    name: 're-run',
    Service: ReRunService,
    model: 'reRunRequest',
    call: (s: ReRunService) =>
      s.updateStatus('e1', 't1', 'A', 'p1', { status: 'DONE' } as never),
  },
  {
    name: 'scheduled test',
    Service: ScheduledTestService,
    model: 'scheduledTest',
    call: (s: ScheduledTestService) =>
      s.updateStatus('e1', 't1', 'A', 'p1', { status: 'DONE' } as never),
  },
])('$name status update follows the report’s branch', (c) => {
  function setup() {
    const findFirst = jest.fn().mockResolvedValue(null);
    const svc = Object.create(c.Service.prototype) as never;
    Object.assign(svc, {
      prisma: { [c.model]: { findFirst } },
    });
    return { svc, findFirst };
  }

  it('looks the row up through its report in the active branch, not by the row’s stored branch', async () => {
    const { svc, findFirst } = setup();
    await expect(
      (c.call as (s: never) => Promise<unknown>)(svc),
    ).rejects.toBeInstanceOf(WorklistEntryNotFoundException);
    const where = (
      findFirst.mock.calls[0] as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where.branchId).toBeUndefined();
    expect(where.labReport).toEqual({
      is: { branchId: 'A', deletedAt: null },
    });
  });
});
