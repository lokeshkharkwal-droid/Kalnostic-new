import { Prisma, RegistrationIdSequenceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import { RegistrationIdSequenceService } from './registration-id-sequence.service';

/**
 * Unit coverage for the id-composition helper, the get-or-create-all-4 shape,
 * and the atomic reset-cycle rollover logic that fixes the old system's
 * unguarded read-then-write counter bug (see schema.prisma doc-comment on
 * `RegistrationIdSequence`).
 */
describe('RegistrationIdSequenceService', () => {
  const txMock = {
    registrationIdSequence: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };
  const prismaMock = {
    registrationIdSequence: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  };
  const branchServiceMock = {
    findById: jest.fn(),
  };

  let service: RegistrationIdSequenceService;

  /** The `{ where, data }` args of the most recent tx.registrationIdSequence.update() call. */
  const lastUpdateCall = (): {
    where: { id: string };
    data: { currentNumber: number; lastResetAt: Date };
  } => {
    const calls = txMock.registrationIdSequence.update.mock
      .calls as unknown as Array<
      [
        {
          where: { id: string };
          data: { currentNumber: number; lastResetAt: Date };
        },
      ]
    >;
    const last = calls[calls.length - 1];
    if (!last) throw new Error('registrationIdSequence.update was not called');
    return last[0];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    branchServiceMock.findById.mockResolvedValue({ id: 'b1', tenantId: 't1' });
    prismaMock.$transaction.mockImplementation(
      (cb: (tx: typeof txMock) => unknown) => cb(txMock),
    );
    service = new RegistrationIdSequenceService(
      prismaMock as unknown as PrismaService,
      branchServiceMock as unknown as BranchService,
    );
  });

  describe('getForBranch', () => {
    it('validates the branch, get-or-creates all 4 sequence types, and attaches a preview', async () => {
      prismaMock.registrationIdSequence.upsert.mockImplementation(
        ({ create }: { create: { sequenceType: string } }) => ({
          id: `${create.sequenceType}-id`,
          prefix: 'ORD',
          suffix: 'AM',
          separator: 'HYPHEN',
          numberLength: 6,
          currentNumber: 0,
          sequenceType: create.sequenceType,
        }),
      );

      const rows = await service.getForBranch('t1', 'b1');

      expect(branchServiceMock.findById).toHaveBeenCalledWith('b1', 't1');
      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.sequenceType).sort()).toEqual(
        ['APPOINTMENT', 'ORDER', 'PATIENT', 'QUOTATION'].sort(),
      );
      expect(rows.at(0)?.preview).toBe('ORD-000001-AM');
    });
  });

  describe('composeId (via preview)', () => {
    it('omits the separator entirely when NONE', async () => {
      prismaMock.registrationIdSequence.upsert.mockResolvedValue({
        prefix: 'PT',
        suffix: '',
        separator: 'NONE',
        numberLength: 4,
        currentNumber: 5,
        sequenceType: 'PATIENT',
      });

      const rows = await service.getForBranch('t1', 'b1');
      expect(rows.at(0)?.preview).toBe('PT0006');
    });

    it('omits an empty suffix segment (no trailing separator)', async () => {
      prismaMock.registrationIdSequence.upsert.mockResolvedValue({
        prefix: 'QUO',
        suffix: '',
        separator: 'SLASH',
        numberLength: 5,
        currentNumber: 0,
        sequenceType: 'QUOTATION',
      });

      const rows = await service.getForBranch('t1', 'b1');
      expect(rows.at(0)?.preview).toBe('QUO/00001');
    });
  });

  describe('generateNext', () => {
    it('increments the current number atomically inside a transaction', async () => {
      txMock.registrationIdSequence.upsert.mockResolvedValue({
        id: 'seq1',
        prefix: 'ORD',
        suffix: '',
        separator: 'HYPHEN',
        numberLength: 6,
        currentNumber: 4,
        resetCycle: 'NEVER',
        lastResetAt: null,
      });
      txMock.registrationIdSequence.update.mockResolvedValue({
        prefix: 'ORD',
        suffix: '',
        separator: 'HYPHEN',
        numberLength: 6,
        currentNumber: 5,
      });

      const result = await service.generateNext(
        't1',
        'b1',
        RegistrationIdSequenceType.ORDER,
      );

      expect(prismaMock.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      const updateCall = lastUpdateCall();
      expect(updateCall.where).toEqual({ id: 'seq1' });
      expect(updateCall.data.currentNumber).toBe(5);
      expect(updateCall.data.lastResetAt).toBeInstanceOf(Date);
      expect(result).toEqual({ id: 'ORD-000005', sequenceNumber: 5 });
    });

    it('resets to 1 when the DAILY reset cycle has rolled over', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000 * 2);
      txMock.registrationIdSequence.upsert.mockResolvedValue({
        id: 'seq1',
        prefix: 'ORD',
        suffix: '',
        separator: 'NONE',
        numberLength: 6,
        currentNumber: 42,
        resetCycle: 'DAILY',
        lastResetAt: yesterday,
      });
      txMock.registrationIdSequence.update.mockResolvedValue({
        prefix: 'ORD',
        suffix: '',
        separator: 'NONE',
        numberLength: 6,
        currentNumber: 1,
      });

      const result = await service.generateNext(
        't1',
        'b1',
        RegistrationIdSequenceType.ORDER,
      );

      const updateCall = lastUpdateCall();
      expect(updateCall.where).toEqual({ id: 'seq1' });
      expect(updateCall.data.currentNumber).toBe(1);
      expect(updateCall.data.lastResetAt).toBeInstanceOf(Date);
      expect(result.sequenceNumber).toBe(1);
    });

    it('never resets when the cycle is NEVER, regardless of lastResetAt age', async () => {
      const longAgo = new Date('2020-01-01T00:00:00.000Z');
      txMock.registrationIdSequence.upsert.mockResolvedValue({
        id: 'seq1',
        prefix: 'ORD',
        suffix: '',
        separator: 'NONE',
        numberLength: 6,
        currentNumber: 9,
        resetCycle: 'NEVER',
        lastResetAt: longAgo,
      });
      txMock.registrationIdSequence.update.mockResolvedValue({
        prefix: 'ORD',
        suffix: '',
        separator: 'NONE',
        numberLength: 6,
        currentNumber: 10,
      });

      const result = await service.generateNext(
        't1',
        'b1',
        RegistrationIdSequenceType.ORDER,
      );

      expect(txMock.registrationIdSequence.update).toHaveBeenCalledWith({
        where: { id: 'seq1' },
        data: { currentNumber: 10, lastResetAt: longAgo },
      });
      expect(result.sequenceNumber).toBe(10);
    });
  });
});
