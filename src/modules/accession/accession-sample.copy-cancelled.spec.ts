import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import { SampleReturnOrderCancelledException } from './exceptions/accession.exceptions';

/**
 * The tube's OWN Repeat and Return of a receiving branch's accepted copy go back to
 * the sender through `returnCopyToOrigin`. When the order was cancelled that road is
 * closed (N-5): the refusal must reach the caller as a 422 `SAMPLE_ORDER_CANCELLED`
 * - or, in a group call with `skipInvalid`, as a skipped row with the sentence and
 * code - and nothing may be written or notified.
 */
function build() {
  const tx = {
    orderSample: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'copy1',
          status: SampleStatus.ACCEPTED,
          sourceTransferId: 'tr1',
          accessionNo: 'ACC-9',
        },
      ]),
    },
    sampleTransfer: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    withTenant: jest.fn((_tenant: string, fn: (t: unknown) => unknown) =>
      Promise.resolve(fn(tx)),
    ),
    orderSample: { findMany: jest.fn().mockResolvedValue([]) },
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
    {} as never,
  );
  const returnCopy = jest
    .fn()
    .mockRejectedValue(
      new SampleReturnOrderCancelledException('repeat', SampleStatus.ACCEPTED),
    );
  (service as unknown as { returnCopyToOrigin: unknown }).returnCopyToOrigin =
    returnCopy;
  // The referring-panel announcement (`emitSampleFlagged`): nothing is announced
  // when the refusal aborts the call.
  const notify = jest.spyOn(
    service as unknown as { emitSampleFlagged: (...a: unknown[]) => void },
    'emitSampleFlagged',
  );
  return { service, tx, returnCopy, notify };
}

describe('OrderSampleService.repeat / returnSample of a received copy on a CANCELLED order', () => {
  it('repeat: refused with SAMPLE_ORDER_CANCELLED, the transfer row is not touched, nobody is notified', async () => {
    const { service, tx, returnCopy, notify } = build();
    const err: unknown = await service
      .repeat(['copy1'], 't1', 'p1', { repeatReason: 'Other' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SampleReturnOrderCancelledException);
    expect((err as SampleReturnOrderCancelledException).errorCode).toBe(
      'SAMPLE_ORDER_CANCELLED',
    );
    expect(returnCopy).toHaveBeenCalledTimes(1);
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    // the refusal aborts before anything is announced to the sender
    expect(notify).not.toHaveBeenCalled();
  });

  it('repeat with skipInvalid: skipped with its sentence and code, nothing succeeds, the transfer row is not touched', async () => {
    const { service, tx } = build();
    const res = await service.repeat(['copy1'], 't1', 'p1', {
      repeatReason: 'Other',
      skipInvalid: true,
    } as never);
    expect(res.succeeded).toEqual([]);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]).toMatchObject({
      id: 'copy1',
      accessionNo: 'ACC-9',
      code: 'SAMPLE_ORDER_CANCELLED',
    });
    expect(res.skipped[0]!.reason).toContain('cancelled');
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
  });

  it('return: refused with SAMPLE_ORDER_CANCELLED and nothing is written', async () => {
    const { service, tx, returnCopy } = build();
    const err: unknown = await service
      .returnSample(['copy1'], 't1', 'p1', {})
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SampleReturnOrderCancelledException);
    expect(returnCopy).toHaveBeenCalledTimes(1);
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
  });

  it('return with skipInvalid: skipped with the cancelled-order code', async () => {
    const { service } = build();
    const res = await service.returnSample(['copy1'], 't1', 'p1', {
      skipInvalid: true,
    } as never);
    expect(res.succeeded).toEqual([]);
    expect(res.skipped[0]).toMatchObject({
      id: 'copy1',
      code: 'SAMPLE_ORDER_CANCELLED',
    });
  });
});
