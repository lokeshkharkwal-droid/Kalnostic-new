import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';

/**
 * The sender's trail entry when the receiving branch sends a sample back. The
 * sample itself does not move (it stays Sent), so the row records no status change
 * - and `findHistory` must still show it.
 */
function build() {
  const rows: Record<string, unknown>[] = [];
  const tx = {
    orderSample: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'orig1',
        branchId: 'A',
        status: SampleStatus.SENT_INTERNAL,
      }),
    },
    orderSampleStatusHistory: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        rows.push(data);
        return Promise.resolve({});
      }),
    },
  };
  const service = new OrderSampleService(
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
  return { service, tx, rows };
}

describe('OrderSampleService.recordReturnedByReceiverInTx', () => {
  it('writes one history row on the sender’s sample: action, reason, and no status change', async () => {
    const { service, tx, rows } = build();
    await service.recordReturnedByReceiverInTx(
      tx as never,
      't1',
      'u1',
      'orig1',
      'clotted',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: 't1',
      branchId: 'A',
      sampleId: 'orig1',
      action: 'returned-by-receiver',
      fromStatus: SampleStatus.SENT_INTERNAL,
      toStatus: SampleStatus.SENT_INTERNAL,
      reason: 'clotted',
      changedBy: 'u1',
    });
    expect(rows[0]!.notes).toContain('clotted');
  });

  it('a sample that is gone writes nothing', async () => {
    const { service, tx, rows } = build();
    tx.orderSample.findFirst.mockResolvedValue(null);
    await service.recordReturnedByReceiverInTx(
      tx as never,
      't1',
      'u1',
      'nope',
      'x',
    );
    expect(rows).toHaveLength(0);
  });
});

describe('Repeat / Error of a Sent sample are the SENDING branch’s only (like Retrieve)', () => {
  function setup(sentBranch: string) {
    const tx = {
      orderSample: {
        // the Sent samples among the ids: one, held by `sentBranch`
        // (the first read is the sender check; any later read - repeat()'s "copies"
        // lookup - finds none)
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 's1', branchId: sentBranch }])
          .mockResolvedValue([]),
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
    const priv = service as unknown as Record<string, jest.Mock>;
    priv.transitionIds = jest
      .fn()
      .mockResolvedValue({ succeeded: [], skipped: [] });
    priv.emitSampleFlagged = jest.fn();
    return { service, priv };
  }

  it.each(['error', 'repeat'] as const)(
    '%s from another branch is refused (403 TRANSFER_WRONG_BRANCH) before anything moves',
    async (action) => {
      const { service, priv } = setup('A');
      const run =
        action === 'error'
          ? service.error(['s1'], 't1', 'p1', {}, 'B')
          : service.repeat(['s1'], 't1', 'p1', { repeatReason: 'x' }, 'B');
      await expect(run).rejects.toMatchObject({
        errorCode: 'TRANSFER_WRONG_BRANCH',
      });
      expect(priv.transitionIds).not.toHaveBeenCalled();
    },
  );

  it.each(['error', 'repeat'] as const)(
    '%s from the sending branch goes on to the normal path',
    async (action) => {
      const { service, priv } = setup('A');
      if (action === 'error') {
        await service.error(['s1'], 't1', 'p1', {}, 'A');
      } else {
        await service.repeat(['s1'], 't1', 'p1', { repeatReason: 'x' }, 'A');
      }
      expect(priv.transitionIds).toHaveBeenCalledTimes(1);
    },
  );

  it('internal callers that pass no branch are not checked', async () => {
    const { service, priv } = setup('A');
    await service.error(['s1'], 't1', 'p1', {});
    expect(priv.transitionIds).toHaveBeenCalledTimes(1);
  });
});

describe('OrderSampleService.findHistory keeps the sender’s "returned by the receiving branch" row', () => {
  it('shows it although it changes no status, and still hides other no-change rows', async () => {
    const histRows = [
      {
        id: 'h1',
        action: 'returned-by-receiver',
        fromStatus: SampleStatus.SENT_INTERNAL,
        toStatus: SampleStatus.SENT_INTERNAL,
        createdAt: new Date('2026-10-22T10:00:00Z'),
      },
      {
        id: 'h2',
        action: 'assign-barcode',
        fromStatus: SampleStatus.SENT_INTERNAL,
        toStatus: SampleStatus.SENT_INTERNAL,
        createdAt: new Date('2026-10-22T09:00:00Z'),
      },
      {
        id: 'h3',
        action: 'send',
        fromStatus: SampleStatus.ACCEPTED,
        toStatus: SampleStatus.SENT_INTERNAL,
        createdAt: new Date('2026-10-22T08:00:00Z'),
      },
    ];
    const prisma = {
      orderSampleStatusHistory: {
        findMany: jest.fn().mockResolvedValue(histRows),
      },
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
    const priv = service as unknown as Record<string, unknown>;
    priv.findById = jest.fn().mockResolvedValue({ id: 'orig1' });
    priv.orderCancelledEntry = jest.fn().mockResolvedValue(null);
    priv.enrichHistoryActors = jest.fn((rows: unknown[]) =>
      Promise.resolve(rows),
    );
    const out = (await service.findHistory('orig1', 't1', 'A')) as Array<{
      id: string;
    }>;
    expect(out.map((r) => r.id)).toEqual(['h1', 'h3']);
  });
});
