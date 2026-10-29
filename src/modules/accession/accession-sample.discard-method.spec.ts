import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';

/**
 * The Discarded tab's "Discard Method" column. The method is stored only as the `reason` of the
 * `discard` history entry, so the list reads it with one batched lookup per page - and only for a
 * sample that is Discarded right now.
 */
describe('OrderSampleService.withDiscardMethods - Discard Method for the list', () => {
  type Hist = { sampleId: string; reason: string | null };

  function setup(history: Hist[]) {
    const findMany = jest
      .fn<Promise<Hist[]>, [Record<string, unknown>]>()
      .mockResolvedValue(history);
    const tx = { orderSampleStatusHistory: { findMany } };
    const prisma = {
      withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const svc = new OrderSampleService(
      prisma as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const methods = (rows: unknown[]) =>
      (
        svc as unknown as {
          withDiscardMethods: (
            t: string,
            r: unknown[],
          ) => Promise<Array<{ id: string; discardMethod?: string | null }>>;
        }
      ).withDiscardMethods('t1', rows);
    return { methods, prisma, findMany };
  }

  const row = (id: string, status: SampleStatus) => ({ id, status });

  it('gives each Discarded row the method of its discard entry, in ONE lookup for the page', async () => {
    const { methods, findMany } = setup([
      { sampleId: 's1', reason: 'Incineration' },
      { sampleId: 's2', reason: 'Autoclave' },
    ]);
    const out = await methods([
      row('s1', SampleStatus.DISCARDED),
      row('s2', SampleStatus.DISCARDED),
      row('s3', SampleStatus.STORED),
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(out[0]!.discardMethod).toBe('Incineration');
    expect(out[1]!.discardMethod).toBe('Autoclave');
    expect(out[2]).not.toHaveProperty('discardMethod'); // a Stored row is left as it is
  });

  it('asks only for the discard entries of the Discarded rows, newest first, not deleted', async () => {
    const { methods, findMany } = setup([]);
    await methods([
      row('s1', SampleStatus.DISCARDED),
      row('s3', SampleStatus.STORED),
    ]);
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        tenantId: 't1',
        sampleId: { in: ['s1'] },
        action: 'discard',
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('a sample discarded twice (retrieved in between) shows its NEWEST method', async () => {
    // The lookup is newest first, so the first entry per sample wins.
    const { methods } = setup([
      { sampleId: 's1', reason: 'Autoclave' },
      { sampleId: 's1', reason: 'Incineration' },
    ]);
    const out = await methods([row('s1', SampleStatus.DISCARDED)]);
    expect(out[0]!.discardMethod).toBe('Autoclave');
  });

  it('a Discarded row with no discard entry (or a blank reason) gets null, not undefined', async () => {
    const { methods } = setup([{ sampleId: 's2', reason: null }]);
    const out = await methods([
      row('s1', SampleStatus.DISCARDED),
      row('s2', SampleStatus.DISCARDED),
    ]);
    expect(out[0]!.discardMethod).toBeNull();
    expect(out[1]!.discardMethod).toBeNull();
  });

  it('a page with no Discarded row costs no query at all', async () => {
    const { methods, prisma } = setup([]);
    const out = await methods([
      row('s1', SampleStatus.STORED),
      row('s2', SampleStatus.ACCEPTED),
    ]);
    expect(prisma.withTenant).not.toHaveBeenCalled();
    expect(out).toHaveLength(2);
  });
});
