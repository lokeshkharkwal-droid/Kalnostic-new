import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import { SampleTransferService } from './sample-transfer.service';
import {
  InvalidSampleTransitionException,
  RetrieveBlockedException,
  SampleOrderCancelledException,
  SampleRetrieveBlockedByResultException,
  SampleSentToBranchException,
  SendBlockedException,
  refusalMessage,
} from './exceptions/accession.exceptions';

/**
 * A group action that SKIPS a sample ("skip invalid") must say WHY: the skipped
 * reason is the refusal's own sentence (cancelled order, nothing to retrieve,
 * result already done, report already worked on ...), not a generic "not allowed
 * from status X". A plain refusal's sentence IS that generic text, so nothing
 * changes for it. `code` is the refusal's own error code.
 */

const sentence = (e: InvalidSampleTransitionException): string =>
  (e.getResponse() as { error: { message: string } }).error.message;

describe('refusalMessage', () => {
  it('is the sentence in the response body, not the class name', () => {
    const e = new SampleOrderCancelledException(
      'retrieve',
      SampleStatus.ACCEPTED,
    );
    expect(refusalMessage(e)).toBe(sentence(e));
    expect(refusalMessage(e)).not.toBe(e.message);
    expect(refusalMessage(e)).toContain('This order has been cancelled');
  });

  it('a plain refusal reads the generic "not allowed from status" text', () => {
    const e = new InvalidSampleTransitionException(
      'hold',
      SampleStatus.ACCEPTED,
    );
    expect(refusalMessage(e)).toBe(
      'Action "hold" is not allowed from status ACCEPTED',
    );
  });
});

describe("a skipped sample in a group action shows the refusal's own sentence", () => {
  function group(refusal: InvalidSampleTransitionException) {
    const tx = {
      orderSample: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'good', accessionNo: 'ACC-1', status: SampleStatus.ACCEPTED },
          { id: 'bad', accessionNo: 'ACC-2', status: SampleStatus.ACCEPTED },
        ]),
      },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const service = new OrderSampleService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const internals = service as unknown as {
      transitionInTx: jest.Mock;
      findById: jest.Mock;
      ensureLabReportsForAcceptedSample: jest.Mock;
      transitionIds: (
        ids: string[],
        tenantId: string,
        personId: string | null,
        action: string,
        build: () => unknown,
        note: Record<string, unknown>,
      ) => Promise<{
        succeeded: unknown[];
        skipped: {
          id: string;
          accessionNo: string | null;
          reason: string;
          code?: string;
        }[];
      }>;
    };
    internals.transitionInTx = jest
      .fn()
      .mockImplementation((_tx: unknown, _t: string, _p: string, id: string) =>
        id === 'bad'
          ? Promise.reject(refusal)
          : Promise.resolve({ id, status: SampleStatus.COLLECTED }),
      );
    internals.findById = jest
      .fn()
      .mockImplementation((id: string) => Promise.resolve({ id }));
    internals.ensureLabReportsForAcceptedSample = jest
      .fn()
      .mockResolvedValue(undefined);
    return internals;
  }

  const run = (refusal: InvalidSampleTransitionException) =>
    group(refusal).transitionIds(
      ['good', 'bad'],
      't1',
      'p1',
      'retrieve',
      () => ({ data: {} }),
      { skipInvalid: true },
    );

  it.each([
    [
      'cancelled order',
      () =>
        new SampleOrderCancelledException('retrieve', SampleStatus.ACCEPTED),
      'SAMPLE_ORDER_CANCELLED',
    ],
    [
      'nothing to retrieve (already back)',
      () => new RetrieveBlockedException(SampleStatus.ACCEPTED, 'RETURNED'),
      'SAMPLE_RETRIEVE_BLOCKED',
    ],
    [
      'already received by the other branch',
      () =>
        new RetrieveBlockedException(SampleStatus.SENT_INTERNAL, 'RECEIVED'),
      'SAMPLE_RETRIEVE_BLOCKED',
    ],
    [
      'result already done',
      () => new SampleRetrieveBlockedByResultException(SampleStatus.ACCEPTED),
      'SAMPLE_RETRIEVE_BLOCKED_RESULT_DONE',
    ],
    [
      'sent to another branch',
      () => new SampleSentToBranchException('hold', SampleStatus.SENT_INTERNAL),
      'SAMPLE_SENT_TO_BRANCH',
    ],
    [
      'send blocked (report already worked on)',
      () =>
        new SendBlockedException(
          SampleStatus.ACCEPTED,
          'The report for this test has already been worked on.',
        ),
      'SAMPLE_SEND_BLOCKED',
    ],
  ])('%s', async (_name, make, code) => {
    const refusal = make();
    const r = await run(refusal);
    expect(r.succeeded).toEqual([{ id: 'good' }]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({
      id: 'bad',
      accessionNo: 'ACC-2',
      code,
    });
    expect(r.skipped[0]!.reason).toBe(sentence(refusal));
    expect(r.skipped[0]!.reason).not.toContain('is not allowed from status');
  });

  it('a plain refusal still reads the generic text (unchanged)', async () => {
    const r = await run(
      new InvalidSampleTransitionException('retrieve', SampleStatus.ACCEPTED),
    );
    expect(r.skipped[0]!.reason).toBe(
      'Action "retrieve" is not allowed from status ACCEPTED',
    );
    expect(r.skipped[0]!.code).toBe('INVALID_SAMPLE_TRANSITION');
  });
});

describe('a skipped sample of a group Send shows why', () => {
  function send(refusal: Error) {
    const tx = {
      orderSample: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 's1', accessionNo: 'ACC-7', status: SampleStatus.ACCEPTED },
          ]),
      },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const samples = {
      assertInternalSendable: jest.fn().mockRejectedValue(refusal),
      transitionInTx: jest.fn(),
    };
    const branches = { findById: jest.fn().mockResolvedValue({}) };
    const svc = new SampleTransferService(
      prisma as never,
      samples as never,
      branches as never,
      {} as never,
    );
    return svc.send(['s1'], 't1', 'p1', {
      destinationBranchId: 'B',
      skipInvalid: true,
    });
  }

  it('a send blocked for its own reason is skipped with that reason and code', async () => {
    const refusal = new SendBlockedException(
      SampleStatus.ACCEPTED,
      'The report for this test has already been worked on (results exist), so the sample cannot be sent to another branch.',
    );
    const r = await send(refusal);
    expect(r.succeeded).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({
      id: 's1',
      accessionNo: 'ACC-7',
      code: 'SAMPLE_SEND_BLOCKED',
    });
    expect(r.skipped[0]!.reason).toContain('already been worked on');
    expect(r.skipped[0]!.reason).not.toContain('is not allowed from status');
  });

  it('a plain refusal still reads the generic text', async () => {
    const r = await send(
      new InvalidSampleTransitionException('send', SampleStatus.ACCEPTED),
    );
    expect(r.skipped[0]!.reason).toBe(
      'Action "send" is not allowed from status ACCEPTED',
    );
  });

  it('an error that is NOT a refusal is never swallowed', async () => {
    await expect(send(new Error('database is down'))).rejects.toThrow(
      'database is down',
    );
  });
});
