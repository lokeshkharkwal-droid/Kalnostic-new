import { SampleStatus } from '@prisma/client';
import { LabReportNotFoundException } from '../exceptions/lab-report.exceptions';
import {
  assertReportNotSentOut,
  findSentOutReportIds,
  isReportSentOut,
} from './sent-out-report.util';

/** Minimal mocked Prisma slice the helpers use. */
function makeDb() {
  return {
    orderSampleTest: { findFirst: jest.fn(), findMany: jest.fn() },
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

    it('throws not-found for a sent-out report and passes otherwise', async () => {
      const db = makeDb();
      db.labReport.findFirst.mockResolvedValue(key);
      db.orderSampleTest.findFirst.mockResolvedValueOnce({ id: 'x' });
      await expect(
        assertReportNotSentOut(asDb(db), 't1', 'r1'),
      ).rejects.toThrow(LabReportNotFoundException);
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
