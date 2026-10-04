import { readFileSync } from 'fs';
import { join } from 'path';
import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { LabReportSentOutException } from './exceptions/lab-report.exceptions';

type Priv = {
  lockReportForWrite: (...a: unknown[]) => Promise<void>;
  requireReport: jest.Mock;
  requireAtLeastOneResultValue: jest.Mock;
};

/** A transaction client recording the order of calls. */
function makeTx(opts: { sentOut: boolean }) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: jest.fn((..._a: unknown[]) => {
      calls.push('lock-row');
      return Promise.resolve([]);
    }),
    labReport: {
      findFirst: jest.fn(() => {
        calls.push('read-report');
        return Promise.resolve({
          branchId: 'A',
          orderItemId: 'item1',
          memberBranchLabTestId: null,
          labTestId: 'lt1',
        });
      }),
      update: jest.fn(() => {
        calls.push('update-report');
        return Promise.resolve({ id: 'r1' });
      }),
    },
    orderSampleTest: {
      findFirst: jest.fn(() =>
        Promise.resolve(opts.sentOut ? { id: 'sent-link' } : null),
      ),
    },
    labReportHistory: { create: jest.fn() },
  };
  return { tx, calls };
}

describe('LabReportService.lockReportForWrite', () => {
  it('locks the report row FIRST, then checks the sample is not sent out', async () => {
    const { tx, calls } = makeTx({ sentOut: false });
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    await (svc as unknown as Priv).lockReportForWrite(tx, 't1', 'r1');
    expect(calls).toEqual(['lock-row', 'read-report']);
  });

  it('refuses the write when the sample was sent while the technician was typing', async () => {
    const { tx } = makeTx({ sentOut: true });
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    await expect(
      (svc as unknown as Priv).lockReportForWrite(tx, 't1', 'r1'),
    ).rejects.toBeInstanceOf(LabReportSentOutException);
  });
});

describe('LabReportService.save - the lock is taken inside the write transaction', () => {
  function build(sentOut: boolean) {
    const { tx, calls } = makeTx({ sentOut });
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    const priv = svc as unknown as Priv;
    Object.assign(svc, {
      prisma: {
        withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
          fn(tx),
        ),
      },
      requireBranch: (b: string) => b,
      requireReport: jest
        .fn()
        .mockResolvedValue({ status: LabReportStatus.PENDING }),
      assertTransition: jest.fn(),
      requireAtLeastOneResultValue: jest.fn().mockResolvedValue(undefined),
      recordHistory: jest.fn().mockResolvedValue(undefined),
    });
    return { svc, tx, calls, priv };
  }

  it('locks the row before it updates the report', async () => {
    const { svc, calls } = build(false);
    await svc.save('r1', 't1', 'A', 'p1');
    expect(calls.indexOf('lock-row')).toBeLessThan(
      calls.indexOf('update-report'),
    );
  });

  it('a Send that committed after the up-front check still stops the write', async () => {
    const { svc, tx } = build(true);
    await expect(svc.save('r1', 't1', 'A', 'p1')).rejects.toBeInstanceOf(
      LabReportSentOutException,
    );
    expect(tx.labReport.update).not.toHaveBeenCalled();
  });
});

describe('LabReportService.lockReports (used by Send and by the receiver’s return)', () => {
  it('does nothing for no reports', async () => {
    const { tx } = makeTx({ sentOut: false });
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    await svc.lockReports(tx as never, 't1', []);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('locks every report in one ordered statement', async () => {
    const { tx } = makeTx({ sentOut: false });
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    await svc.lockReports(tx as never, 't1', ['r2', 'r1']);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    // a tagged template: the first argument is the array of SQL fragments
    const strings = (tx.$queryRaw.mock.calls[0] as unknown as [string[]])[0];
    const text = strings.join('?');
    expect(text).toContain('FOR UPDATE');
    expect(text).toContain('ORDER BY id');
  });
});

describe('every technician write transaction takes the report lock', () => {
  // A source check on purpose: it fails the moment someone adds or rewrites a
  // write transaction without the lock, which a behavioural test would not see.
  const source = readFileSync(join(__dirname, 'lab-report.service.ts'), 'utf8');
  const writers = [
    'upsertResultValues',
    'save',
    'submit',
    'validate',
    'editReport',
    'reject',
    'resubmit',
    'approve',
    'publish',
    'errorReported',
    'resetForRerun',
    'lock',
  ];

  it.each(writers)(
    '%s locks the row as the first step of its transaction',
    (name) => {
      const start = source.indexOf(`\n  async ${name}(`);
      expect(start).toBeGreaterThan(-1);
      const tail = source.slice(start + 10);
      const next = tail.search(
        /\n {2}(async |private async |private |public )?[a-zA-Z]+\(/,
      );
      const body = next === -1 ? tail : tail.slice(0, next);
      const tx = body.indexOf('withTenant(tenantId, async (tx) => {');
      expect(tx).toBeGreaterThan(-1);
      const afterOpen = body
        .slice(tx + 'withTenant(tenantId, async (tx) => {'.length)
        .trimStart();
      expect(
        afterOpen.startsWith(
          'await this.lockReportForWrite(tx, tenantId, id);',
        ),
      ).toBe(true);
    },
  );
});
