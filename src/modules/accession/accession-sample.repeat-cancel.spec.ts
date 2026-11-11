import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import { SampleRepeatCancelBlockedException } from './exceptions/accession.exceptions';
import { nextSampleStatus } from './constants/sample-transitions.constant';

/**
 * A sample waiting to be collected again (status Repeat) cannot be cancelled: its report was reset for the repeat and
 * stays locked until the sample is accepted again, and a cancelled sample would leave that report with no sample behind it.
 *  - the transition table no longer offers Cancel from Repeat;
 *  - a group "force" Cancel (which skips the table) is refused for a Repeat sample too, and with "skip invalid" the
 *    other samples of the group are still cancelled;
 *  - New, Collected and Hold samples can still be cancelled.
 */
interface SampleRow {
  id: string;
  orderId: string;
  branchId: string;
  status: SampleStatus;
  previousStatus: SampleStatus | null;
  sourceTransferId: string | null;
}

function build(samples: SampleRow[]) {
  const byId = new Map(samples.map((s) => [s.id, s]));
  const tx = {
    orderSample: {
      findFirst: jest
        .fn()
        .mockImplementation((args: { where: { id: string } }) =>
          Promise.resolve(byId.get(args.where.id) ?? null),
        ),
      findMany: jest.fn().mockResolvedValue(
        samples.map((s) => ({
          id: s.id,
          accessionNo: `ACC-${s.id}`,
          status: s.status,
        })),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest
        .fn()
        .mockImplementation((args: { where: { id: string } }) =>
          Promise.resolve({ id: args.where.id }),
        ),
    },
    order: { findFirst: jest.fn().mockResolvedValue(null) },
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
    orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
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
  (service as unknown as { findById: jest.Mock }).findById = jest
    .fn()
    .mockImplementation((id: string) => Promise.resolve({ id }));
  const cancel = (ids: string[], extra: Record<string, unknown> = {}) =>
    service.cancel(ids, 't1', 'p1', {
      reason: 'no longer needed',
      ...extra,
    });
  return { tx, cancel };
}

const row = (id: string, status: SampleStatus): SampleRow => ({
  id,
  orderId: 'o1',
  branchId: 'A',
  status,
  previousStatus: null,
  sourceTransferId: null,
});

describe('the transition table', () => {
  it('has no Cancel from Repeat', () => {
    expect(nextSampleStatus('cancel', SampleStatus.REPEAT)).toBeNull();
  });

  it.each([SampleStatus.NEW, SampleStatus.COLLECTED, SampleStatus.HOLD])(
    'still cancels a %s sample',
    (status) => {
      expect(nextSampleStatus('cancel', status)).toBe(SampleStatus.CANCELLED);
    },
  );
});

describe('Cancel on a Repeat sample', () => {
  it('is refused with SAMPLE_CANCEL_BLOCKED_REPEAT and nothing is written', async () => {
    const m = build([row('s1', SampleStatus.REPEAT)]);
    const e: unknown = await m.cancel(['s1']).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SampleRepeatCancelBlockedException);
    expect(e).toMatchObject({ errorCode: 'SAMPLE_CANCEL_BLOCKED_REPEAT' });
    expect(m.tx.orderSample.update).not.toHaveBeenCalled();
    expect(m.tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
  });

  it('is refused even by a group "force" Cancel (which skips the transition table)', async () => {
    const m = build([row('s1', SampleStatus.REPEAT)]);
    await expect(m.cancel(['s1'], { force: true })).rejects.toBeInstanceOf(
      SampleRepeatCancelBlockedException,
    );
    expect(m.tx.orderSample.update).not.toHaveBeenCalled();
  });

  it('a group Cancel with "skip invalid" skips the Repeat sample and still cancels the others', async () => {
    const m = build([
      row('s1', SampleStatus.REPEAT),
      row('s2', SampleStatus.COLLECTED),
    ]);
    const result = await m.cancel(['s1', 's2'], {
      force: true,
      skipInvalid: true,
    });
    expect(result.succeeded.map((s) => (s as { id: string }).id)).toEqual([
      's2',
    ]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      id: 's1',
      code: 'SAMPLE_CANCEL_BLOCKED_REPEAT',
    });
    // only the Collected sample was written
    const updatedIds = m.tx.orderSample.update.mock.calls.map(
      (c) => (c as [{ where: { id: string } }])[0].where.id,
    );
    expect(updatedIds).toEqual(['s2']);
  });
});

describe('Cancel on the other samples is unchanged', () => {
  it.each([SampleStatus.NEW, SampleStatus.COLLECTED, SampleStatus.HOLD])(
    'a %s sample is cancelled',
    async (status) => {
      const m = build([row('s1', status)]);
      const result = await m.cancel(['s1']);
      expect(result.succeeded).toHaveLength(1);
      expect(m.tx.orderSample.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SampleStatus.CANCELLED,
          }) as Record<string, unknown>,
        }),
      );
    },
  );
});
