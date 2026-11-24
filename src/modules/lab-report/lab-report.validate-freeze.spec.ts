import {
  AbnormalFlag,
  LabReportStatus,
  Prisma,
  ResultType,
} from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { InvalidLabReportTransitionException } from './exceptions/lab-report.exceptions';

/**
 * `validate()` is the only route into a printable status, so it is where a report's print is frozen:
 * in the SAME transaction as the status change, after a status re-check under the row lock. Reopening
 * the report (Edit Report, Error Reported) drops the freeze again.
 */
jest.setTimeout(30_000);

const T = 't1';
const NOW_UPDATED = new Date('2026-11-01T10:00:00.000Z');

function build(opts: {
  /** Return this many readings of parameter p1 instead of the default two. */
  many?: number;
  status?: LabReportStatus;
  lockedStatus?: LabReportStatus;
  params?: Array<Record<string, unknown>>;
}) {
  const order: string[] = [];
  const status = opts.status ?? LabReportStatus.VALIDATION_PENDING;
  const tx = {
    labReport: {
      findUnique: jest.fn(() =>
        Promise.resolve({ status: opts.lockedStatus ?? status }),
      ),
      update: jest.fn((a: unknown) => {
        order.push('status');
        return Promise.resolve(a);
      }),
    },
    labReportNote: { create: jest.fn() },
    labReportResultValue: {
      findMany: jest.fn().mockResolvedValue(
        opts.many
          ? Array.from({ length: opts.many }, (_x, i) => ({
              id: `m${i}`,
              resultParamId: 'p1',
              observed1: '150',
              observed2: null,
              flagOption: 'DEFAULT',
              highlightLogic: null,
              referenceRangeId: 'rr1',
            }))
          : [
              {
                id: 'v1',
                resultParamId: 'p1',
                observed1: '150',
                observed2: null,
                flagOption: 'DEFAULT',
                highlightLogic: null,
                referenceRangeId: 'rr1',
                updatedAt: NOW_UPDATED,
              },
              {
                id: 'v2',
                resultParamId: 'gone',
                observed1: '5',
                observed2: null,
                flagOption: 'DEFAULT',
                highlightLogic: null,
                referenceRangeId: null,
                updatedAt: NOW_UPDATED,
              },
            ],
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    // the freeze is ONE batched statement: $executeRaw`UPDATE ... unnest(${ids}, ${snapshots}) ...`
    $executeRaw: jest.fn((..._args: unknown[]) => {
      order.push('freeze');
      return Promise.resolve(1);
    }),
    labTestResultParam: {
      findMany: jest.fn().mockResolvedValue(
        opts.params ?? [
          {
            id: 'p1',
            parameterName: 'Glucose',
            groupName: 'Chem',
            sortOrder: 2,
            resultType: ResultType.QUANTITATIVE,
            abnormalFlagLogic: AbnormalFlag.ITALIC,
            notes: 'n',
          },
        ],
      ),
    },
    labTestReferenceRange: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'rr1', lowerLimit: 70, upperLimit: 110 }]),
    },
  };
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  const warn = jest.fn();
  Object.assign(svc, {
    logger: { warn, log: jest.fn() },
    requireBranch: (b: string) => b,
    requireReport: jest.fn().mockResolvedValue({ id: 'r1', status }),
    tatService: {
      resolveReportingDeferral: jest
        .fn()
        .mockResolvedValue({ deferredUntil: null }),
    },
    lockReportForWrite: jest.fn().mockResolvedValue(undefined),
    recordHistory: jest.fn().mockResolvedValue(undefined),
    prisma: {
      withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ),
    },
  });
  return { svc, tx, order, warn };
}

/** What the batched freeze statement was given: the reading ids and their snapshots (parsed). */
const frozenBy = (tx: { $executeRaw: jest.Mock }) => {
  const call = tx.$executeRaw.mock.calls[0] as unknown as [
    TemplateStringsArray,
    string[],
    string[],
    string,
  ];
  return {
    sql: call[0].join('?'),
    ids: call[1],
    snapshots: call[2].map((x) => JSON.parse(x) as Record<string, unknown>),
    tenantId: call[3],
  };
};

describe('validate() freezes the print', () => {
  it('freezes every reading BEFORE the status becomes Result Done, inside the one transaction', async () => {
    const { svc, tx, order } = build({});
    await svc.validate('r1', T, 'b1', 'actor');
    expect(order).toEqual(['freeze', 'status']);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const f = frozenBy(tx);
    expect(f.ids).toEqual(['v1']);
    expect(f.tenantId).toBe(T);
    expect(f.snapshots[0]).toMatchObject({
      v: 1,
      name: 'Glucose',
      group: 'Chem',
      order: 2,
      o1: { style: AbnormalFlag.ITALIC, abnormal: true },
    });
  });

  it('is ONE statement however many readings there are (no round trip per reading)', async () => {
    const { svc, tx } = build({ many: 400 });
    await svc.validate('r1', T, 'b1', 'actor');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(frozenBy(tx).ids.length).toBe(400);
  });

  it('does not touch updated_at (freezing is not an edit of the reading) and is scoped to the tenant', async () => {
    const { svc, tx } = build({});
    await svc.validate('r1', T, 'b1', 'actor');
    const f = frozenBy(tx);
    expect(f.sql).not.toMatch(/updated_at/i);
    expect(f.sql).toMatch(/tenant_id/);
  });

  it('a reading whose parameter no longer exists is left unfrozen, with a warning, and the validate still succeeds', async () => {
    const { svc, tx, warn } = build({});
    await svc.validate('r1', T, 'b1', 'actor');
    expect(frozenBy(tx).ids).toEqual(['v1']); // v1 only, not v2
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('gone'));
  });

  it('a status that changed under the lock (another validate or an Edit Report won) is refused and NOTHING is written', async () => {
    const { svc, tx } = build({ lockedStatus: LabReportStatus.RESULT_DONE });
    await expect(svc.validate('r1', T, 'b1', 'actor')).rejects.toBeInstanceOf(
      InvalidLabReportTransitionException,
    );
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.labReport.update).not.toHaveBeenCalled();
  });

  it('a validate from a status that does not allow it is refused before any transaction', async () => {
    const { svc, tx } = build({ status: LabReportStatus.PENDING });
    await expect(svc.validate('r1', T, 'b1', 'actor')).rejects.toBeInstanceOf(
      InvalidLabReportTransitionException,
    );
    expect(tx.labReportResultValue.findMany).not.toHaveBeenCalled();
  });

  it('a report with no readings validates without freezing anything', async () => {
    const { svc, tx } = build({});
    tx.labReportResultValue.findMany.mockResolvedValueOnce([]);
    await svc.validate('r1', T, 'b1', 'actor');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.labReport.update).toHaveBeenCalledTimes(1);
  });
});

describe('reopening a report drops the freeze', () => {
  it('Edit Report clears the frozen decision of its readings, then sets the status', async () => {
    const { svc, tx, order } = build({ status: LabReportStatus.RESULT_DONE });
    await svc.editReport('r1', T, 'b1', 'actor');
    expect(tx.labReportResultValue.updateMany).toHaveBeenCalledWith({
      where: {
        labReportId: 'r1',
        tenantId: T,
        printSnapshot: { not: Prisma.DbNull },
      },
      data: { printSnapshot: Prisma.DbNull },
    });
    expect(order).toEqual(['status']);
  });

  it('Error Reported clears it too', async () => {
    const { svc, tx } = build({ status: LabReportStatus.PUBLISHED });
    await svc.errorReported('r1', T, 'b1', 'actor', 'wrong patient');
    expect(tx.labReportResultValue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { printSnapshot: Prisma.DbNull } }),
    );
  });
});
