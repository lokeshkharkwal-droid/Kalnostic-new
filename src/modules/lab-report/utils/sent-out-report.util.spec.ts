import { SampleStatus } from '@prisma/client';
import {
  LabReportNotFoundException,
  LabReportOrderCancelledException,
  LabReportSampleAwaitingException,
  LabReportSentOutException,
} from '../exceptions/lab-report.exceptions';
import {
  assertReportNotSentOut,
  assertReportWritable,
  findSentOutReportIds,
  isReportAwaitingSample,
  isReportSentOut,
} from './sent-out-report.util';

/** Minimal mocked Prisma slice the helpers use. */
function makeDb() {
  return {
    orderSampleTest: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    labReport: { findFirst: jest.fn(), findMany: jest.fn() },
  };
}
type Db = ReturnType<typeof makeDb>;
const asDb = (db: Db) => db as never;

/** `where` of the first call to a mocked Prisma method. */
interface CallWhere {
  orderItemId: string;
  labTestId?: string;
  sample: { is: object };
}
const firstWhere = (fn: jest.Mock): CallWhere =>
  (fn.mock.calls[0] as [{ where: CallWhere }])[0].where;

const key = {
  branchId: 'A',
  orderItemId: 'item1',
  memberBranchLabTestId: null,
  labTestId: 'lt1',
};

describe('sent-out report rule', () => {
  describe('isReportSentOut', () => {
    it('is false without a holding branch (no query)', async () => {
      const db = makeDb();
      expect(
        await isReportSentOut(asDb(db), 't1', { ...key, branchId: null }),
      ).toBe(false);
      expect(db.orderSampleTest.findFirst).not.toHaveBeenCalled();
    });

    it("matches only the holder's own SENT_INTERNAL sample", async () => {
      const db = makeDb();
      db.orderSampleTest.findFirst.mockResolvedValue({ id: 'x' });
      expect(await isReportSentOut(asDb(db), 't1', key)).toBe(true);
      const where = firstWhere(db.orderSampleTest.findFirst);
      expect(where.orderItemId).toBe('item1');
      expect(where.sample.is).toMatchObject({
        branchId: 'A',
        status: SampleStatus.SENT_INTERNAL,
        deletedAt: null,
      });
      // non-panel report: no per-member test filter
      expect(where).not.toHaveProperty('labTestId');
    });

    it('scopes a panel-member report to its own member test', async () => {
      const db = makeDb();
      db.orderSampleTest.findFirst.mockResolvedValue(null);
      const res = await isReportSentOut(asDb(db), 't1', {
        ...key,
        memberBranchLabTestId: 'm1',
      });
      expect(res).toBe(false);
      expect(firstWhere(db.orderSampleTest.findFirst).labTestId).toBe('lt1');
    });
  });

  describe('assertReportNotSentOut', () => {
    it('throws not-found for a missing report', async () => {
      const db = makeDb();
      db.labReport.findFirst.mockResolvedValue(null);
      await expect(
        assertReportNotSentOut(asDb(db), 't1', 'r1'),
      ).rejects.toThrow(LabReportNotFoundException);
    });

    it('throws the view-only (sent out) error for a sent-out report and passes otherwise', async () => {
      const db = makeDb();
      db.labReport.findFirst.mockResolvedValue(key);
      db.orderSampleTest.findFirst.mockResolvedValueOnce({ id: 'x' });
      await expect(
        assertReportNotSentOut(asDb(db), 't1', 'r1'),
      ).rejects.toThrow(LabReportSentOutException);
      db.orderSampleTest.findFirst.mockResolvedValueOnce(null);
      await expect(
        assertReportNotSentOut(asDb(db), 't1', 'r1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('findSentOutReportIds', () => {
    it('returns [] when no sent-out link has a report at the branch', async () => {
      const db = makeDb();
      db.orderSampleTest.findMany.mockResolvedValue([]);
      expect(await findSentOutReportIds(asDb(db), 't1', 'A')).toEqual([]);
      expect(db.labReport.findMany).not.toHaveBeenCalled();
    });

    it('hides a non-panel report and only the sent member of a panel', async () => {
      const db = makeDb();
      db.orderSampleTest.findMany.mockResolvedValue([
        { orderItemId: 'solo', labTestId: 'x' },
        { orderItemId: 'panel', labTestId: 'm1' },
      ]);
      db.labReport.findMany.mockResolvedValue([
        {
          id: 'r-solo',
          orderItemId: 'solo',
          memberBranchLabTestId: null,
          labTestId: 'x',
        },
        {
          id: 'r-m1',
          orderItemId: 'panel',
          memberBranchLabTestId: 'b1',
          labTestId: 'm1',
        },
        {
          id: 'r-m2',
          orderItemId: 'panel',
          memberBranchLabTestId: 'b2',
          labTestId: 'm2',
        },
      ]);
      expect(await findSentOutReportIds(asDb(db), 't1', 'A')).toEqual([
        'r-solo',
        'r-m1',
      ]);
    });
  });
});

describe('assertReportWritable - the one write lock', () => {
  /** First labReport.findFirst is the cancelled-order probe, the next the report. */
  const dbWith = (opts: { cancelled: boolean; sentOut?: boolean }) => {
    const db = makeDb();
    db.labReport.findFirst
      .mockResolvedValueOnce(opts.cancelled ? { id: 'r1' } : null)
      .mockResolvedValueOnce({ ...key });
    db.orderSampleTest.findFirst.mockResolvedValue(
      opts.sentOut ? { id: 'link' } : null,
    );
    return db;
  };

  it('refuses a report whose order is cancelled', async () => {
    const db = dbWith({ cancelled: true });
    await expect(
      assertReportWritable(asDb(db), 't1', 'r1'),
    ).rejects.toBeInstanceOf(LabReportOrderCancelledException);
    // refused before the sent-out lookup is even made
    expect(db.orderSampleTest.findFirst).not.toHaveBeenCalled();
  });

  it('asks about the order of this very report, tenant-scoped and live only', async () => {
    const db = dbWith({ cancelled: false });
    await assertReportWritable(asDb(db), 't1', 'r1');
    const where = (
      db.labReport.findFirst.mock.calls[0] as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where).toMatchObject({
      id: 'r1',
      tenantId: 't1',
      deletedAt: null,
      orderItem: { order: { status: 'CANCELLED' } },
    });
  });

  it('reports the 409 code the screen can recognise', async () => {
    const db = dbWith({ cancelled: true });
    await expect(
      assertReportWritable(asDb(db), 't1', 'r1'),
    ).rejects.toMatchObject({
      response: { error: { code: 'LAB_REPORT_ORDER_CANCELLED' } },
    });
  });

  it('lets a normal report through', async () => {
    const db = dbWith({ cancelled: false });
    await expect(
      assertReportWritable(asDb(db), 't1', 'r1'),
    ).resolves.toBeUndefined();
  });

  it('still refuses a sent-out report on an order that is not cancelled', async () => {
    const db = dbWith({ cancelled: false, sentOut: true });
    await expect(
      assertReportWritable(asDb(db), 't1', 'r1'),
    ).rejects.toBeInstanceOf(LabReportSentOutException);
  });

  it('a missing report is still a plain not-found', async () => {
    const db = makeDb();
    db.labReport.findFirst.mockResolvedValue(null);
    await expect(
      assertReportWritable(asDb(db), 't1', 'nope'),
    ).rejects.toBeInstanceOf(LabReportNotFoundException);
  });

  it('refuses a report whose sample is on Repeat (awaiting re-acceptance)', async () => {
    const db = dbWith({ cancelled: false });
    db.orderSampleTest.findMany.mockResolvedValue([
      { sample: { status: SampleStatus.REPEAT } },
    ]);
    await expect(
      assertReportWritable(asDb(db), 't1', 'r1'),
    ).rejects.toBeInstanceOf(LabReportSampleAwaitingException);
  });

  it('reports the 409 code the screen can recognise', async () => {
    const db = dbWith({ cancelled: false });
    db.orderSampleTest.findMany.mockResolvedValue([
      { sample: { status: SampleStatus.COLLECTED } },
    ]);
    await expect(
      assertReportWritable(asDb(db), 't1', 'r1'),
    ).rejects.toMatchObject({
      response: { error: { code: 'LAB_REPORT_SAMPLE_AWAITING' } },
    });
  });

  it('a sent-out report keeps its own refusal (checked first)', async () => {
    const db = dbWith({ cancelled: false, sentOut: true });
    db.orderSampleTest.findMany.mockResolvedValue([
      { sample: { status: SampleStatus.REPEAT } },
    ]);
    await expect(
      assertReportWritable(asDb(db), 't1', 'r1'),
    ).rejects.toBeInstanceOf(LabReportSentOutException);
  });

  it('allowAwaitingSample lets a non-result write through while the sample is on Repeat', async () => {
    const db = dbWith({ cancelled: false });
    db.orderSampleTest.findMany.mockResolvedValue([
      { sample: { status: SampleStatus.REPEAT } },
    ]);
    await expect(
      assertReportWritable(asDb(db), 't1', 'r1', { allowAwaitingSample: true }),
    ).resolves.toBeUndefined();
  });

  it('allowAwaitingSample never lets a sent-out report through', async () => {
    const db = dbWith({ cancelled: false, sentOut: true });
    await expect(
      assertReportWritable(asDb(db), 't1', 'r1', { allowAwaitingSample: true }),
    ).rejects.toBeInstanceOf(LabReportSentOutException);
  });

  it('allowAwaitingSample never lets a cancelled order through', async () => {
    const db = dbWith({ cancelled: true });
    await expect(
      assertReportWritable(asDb(db), 't1', 'r1', { allowAwaitingSample: true }),
    ).rejects.toBeInstanceOf(LabReportOrderCancelledException);
  });

  it('lets an accepted sample through', async () => {
    const db = dbWith({ cancelled: false });
    db.orderSampleTest.findMany.mockResolvedValue([
      { sample: { status: SampleStatus.ACCEPTED } },
    ]);
    await expect(
      assertReportWritable(asDb(db), 't1', 'r1'),
    ).resolves.toBeUndefined();
  });
});

describe('isReportAwaitingSample', () => {
  const links = (...statuses: SampleStatus[]) =>
    statuses.map((status) => ({ sample: { status } }));

  it('is false without a holding branch (no query)', async () => {
    const db = makeDb();
    expect(
      await isReportAwaitingSample(asDb(db), 't1', { ...key, branchId: null }),
    ).toBe(false);
    expect(db.orderSampleTest.findMany).not.toHaveBeenCalled();
  });

  it('is false when the holder has no live sample for the test (rule does not apply)', async () => {
    const db = makeDb();
    db.orderSampleTest.findMany.mockResolvedValue([]);
    expect(await isReportAwaitingSample(asDb(db), 't1', key)).toBe(false);
  });

  it.each([
    SampleStatus.NEW,
    SampleStatus.COLLECTED,
    SampleStatus.ACQUIRED,
    SampleStatus.HALT,
    SampleStatus.ERROR,
    SampleStatus.HOLD,
    SampleStatus.REPEAT,
  ])('is true while the only sample is %s (before Accept)', async (status) => {
    const db = makeDb();
    db.orderSampleTest.findMany.mockResolvedValue(links(status));
    expect(await isReportAwaitingSample(asDb(db), 't1', key)).toBe(true);
  });

  it.each([
    SampleStatus.ACCEPTED,
    SampleStatus.STORED,
    SampleStatus.DISCARDED,
    SampleStatus.RETURNED,
    SampleStatus.SENT_INTERNAL,
    SampleStatus.FORWARD_EXTERNAL,
    SampleStatus.OUTSOURCED,
    SampleStatus.CANCELLED,
  ])('is false once the sample is %s (accepted or beyond)', async (status) => {
    const db = makeDb();
    db.orderSampleTest.findMany.mockResolvedValue(links(status));
    expect(await isReportAwaitingSample(asDb(db), 't1', key)).toBe(false);
  });

  it('a test with two containers is workable once one container is accepted', async () => {
    const db = makeDb();
    db.orderSampleTest.findMany.mockResolvedValue(
      links(SampleStatus.REPEAT, SampleStatus.ACCEPTED),
    );
    expect(await isReportAwaitingSample(asDb(db), 't1', key)).toBe(false);
  });

  it('only looks at the holder branch’s own live samples', async () => {
    const db = makeDb();
    await isReportAwaitingSample(asDb(db), 't1', key);
    const where = firstWhere(db.orderSampleTest.findMany);
    expect(where.orderItemId).toBe('item1');
    expect(where.sample.is).toMatchObject({ branchId: 'A', deletedAt: null });
    expect(where).not.toHaveProperty('labTestId');
  });

  it('scopes a panel-member report to its own member test', async () => {
    const db = makeDb();
    await isReportAwaitingSample(asDb(db), 't1', {
      ...key,
      memberBranchLabTestId: 'm1',
      labTestId: 'lt9',
    });
    expect(firstWhere(db.orderSampleTest.findMany).labTestId).toBe('lt9');
  });
});
