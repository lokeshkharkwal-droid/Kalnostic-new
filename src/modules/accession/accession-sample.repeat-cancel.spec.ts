import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import { SampleRepeatMustBeCollectedException } from './exceptions/accession.exceptions';
import { nextSampleStatus } from './constants/sample-transitions.constant';

/**
 * A sample waiting to be collected again (status Repeat) can be cancelled (Sample Search requirements, 2026-11-06). Its report
 * was reset for the repeat and stays locked ("Sample cancelled") until Retrieve brings the sample back or the test is removed
 * from the order - the same end state as putting the sample on Hold first and cancelling it from there.
 *  - the transition table offers Cancel from Repeat;
 *  - a group "force" Cancel works for a Repeat sample too, and with "skip invalid" the other samples of the group go on;
 *  - the other forced actions from Repeat stay refused (they would skip the Collect that makes the new barcode).
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
  const accept = (ids: string[], extra: Record<string, unknown> = {}) =>
    service.accept(ids, 't1', 'p1', { sampleCondition: 'Good', ...extra });
  return { tx, cancel, accept };
}

const row = (id: string, status: SampleStatus): SampleRow => ({
  id,
  orderId: 'o1',
  branchId: 'A',
  status,
  previousStatus: null,
  sourceTransferId: null,
});

const updatedIds = (m: ReturnType<typeof build>) =>
  m.tx.orderSample.update.mock.calls.map(
    (c) => (c as [{ where: { id: string } }])[0].where.id,
  );

describe('the transition table', () => {
  it.each([
    SampleStatus.NEW,
    SampleStatus.COLLECTED,
    SampleStatus.HOLD,
    SampleStatus.REPEAT,
  ])('cancels a %s sample', (status) => {
    expect(nextSampleStatus('cancel', status)).toBe(SampleStatus.CANCELLED);
  });

  it.each([SampleStatus.ACCEPTED, SampleStatus.STORED, SampleStatus.CANCELLED])(
    'has no Cancel from %s',
    (status) => {
      expect(nextSampleStatus('cancel', status)).toBeNull();
    },
  );
});

describe('Cancel on a Repeat sample', () => {
  it('moves the sample to Cancelled and writes the history row', async () => {
    const m = build([row('s1', SampleStatus.REPEAT)]);
    const result = await m.cancel(['s1']);
    expect(result.succeeded).toHaveLength(1);
    expect(m.tx.orderSample.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SampleStatus.CANCELLED,
        }) as Record<string, unknown>,
      }),
    );
    expect(m.tx.orderSampleStatusHistory.create).toHaveBeenCalled();
  });

  it('works for a group "force" Cancel (which skips the transition table) too', async () => {
    const m = build([row('s1', SampleStatus.REPEAT)]);
    const result = await m.cancel(['s1'], { force: true });
    expect(result.succeeded).toHaveLength(1);
    expect(updatedIds(m)).toEqual(['s1']);
  });

  it('a group Cancel cancels the Repeat sample and the others together', async () => {
    const m = build([
      row('s1', SampleStatus.REPEAT),
      row('s2', SampleStatus.COLLECTED),
    ]);
    const result = await m.cancel(['s1', 's2'], {
      force: true,
      skipInvalid: true,
    });
    expect(result.succeeded.map((s) => (s as { id: string }).id)).toEqual([
      's1',
      's2',
    ]);
    expect(result.skipped).toHaveLength(0);
    expect(updatedIds(m)).toEqual(['s1', 's2']);
  });

  it('other forced actions from Repeat stay refused (they would skip the Collect that makes the new barcode)', async () => {
    const m = build([row('s1', SampleStatus.REPEAT)]);
    const e: unknown = await m
      .accept(['s1'], { force: true })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SampleRepeatMustBeCollectedException);
    expect(m.tx.orderSample.update).not.toHaveBeenCalled();
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
