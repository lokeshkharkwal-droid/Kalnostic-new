import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import {
  InvalidSampleTransitionException,
  SampleOrderCancelledException,
} from './exceptions/accession.exceptions';

/**
 * Accession Sample Notes (Update Sample) are refused on a cancelled order - its
 * samples are frozen, and legacy had no way to add a sample note after a cancel.
 * Share & Inform stays allowed (telling the patient about a cancelled order is a
 * real use, and legacy never blocked sharing). Nothing is written when refused.
 */

/** The first argument of the n-th call of a mock, typed. */
const callArg = <T>(mock: jest.Mock, n = 0): T =>
  (mock.mock.calls[n] as unknown[])[0] as T;

interface SampleRow {
  id: string;
  orderId: string;
  branchId: string;
  status: SampleStatus;
}

function build(opts: { samples: SampleRow[]; cancelledOrders?: string[] }) {
  const cancelled = new Set(opts.cancelledOrders ?? []);
  const tx = {
    orderSample: {
      findFirst: jest
        .fn()
        .mockImplementation((args: { where: { id: string } }) =>
          Promise.resolve(
            opts.samples.find((s) => s.id === args.where.id) ?? null,
          ),
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    order: {
      findFirst: jest
        .fn()
        .mockImplementation((args: { where: { id: string } }) =>
          Promise.resolve(
            cancelled.has(args.where.id) ? { id: args.where.id } : null,
          ),
        ),
    },
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
  const notes = (
    ids: string[],
    dto: { notes?: string; attachmentUrl?: string } = { notes: 'a note' },
  ) => service.updateNotes(ids, 't1', 'p1', dto);
  const share = (id: string) =>
    service.share(id, 't1', 'p1', {
      channel: 'SMS_API',
      informTo: 'PATIENT',
      message: 'your order was cancelled',
    } as never);
  const nothingWritten = () => {
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
  };
  return { service, tx, notes, share, nothingWritten };
}

const sample = (
  id: string,
  orderId: string,
  status: SampleStatus = SampleStatus.ACCEPTED,
): SampleRow => ({ id, orderId, branchId: 'A', status });

describe('Accession Sample Notes on a cancelled order', () => {
  it('is refused, with a message that says notes can no longer be added', async () => {
    const m = build({
      samples: [sample('s1', 'o1')],
      cancelledOrders: ['o1'],
    });
    const e = (await m
      .notes(['s1'])
      .catch((x: unknown) => x)) as SampleOrderCancelledException;
    expect(e).toBeInstanceOf(SampleOrderCancelledException);
    expect(e.errorCode).toBe('SAMPLE_ORDER_CANCELLED');
    expect(e.getStatus()).toBe(422);
    const msg = (e.getResponse() as { error: { message: string } }).error
      .message;
    expect(msg).toBe(
      'This order has been cancelled, so notes can no longer be added to its samples.',
    );
    m.nothingWritten();
  });

  it('the refusal is an invalid-transition error, so a group "skip invalid" treats it like the others', async () => {
    const m = build({ samples: [sample('s1', 'o1')], cancelledOrders: ['o1'] });
    await expect(m.notes(['s1'])).rejects.toBeInstanceOf(
      InvalidSampleTransitionException,
    );
  });

  it('asks about the order of THIS sample, tenant-scoped', async () => {
    const m = build({ samples: [sample('s1', 'o9')], cancelledOrders: ['o9'] });
    await m.notes(['s1']).catch(() => undefined);
    expect(m.tx.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o9', tenantId: 't1', status: 'CANCELLED' },
      }),
    );
  });

  it.each([
    SampleStatus.NEW,
    SampleStatus.COLLECTED,
    SampleStatus.ACCEPTED,
    SampleStatus.STORED,
    SampleStatus.SENT_INTERNAL,
    SampleStatus.REPEAT,
  ])('is refused whatever the sample status (%s)', async (status) => {
    const m = build({
      samples: [sample('s1', 'o1', status)],
      cancelledOrders: ['o1'],
    });
    await expect(m.notes(['s1'])).rejects.toBeInstanceOf(
      SampleOrderCancelledException,
    );
    m.nothingWritten();
  });

  it('a group is all-or-nothing: one cancelled sample refuses the batch, and the cancelled one is never written', async () => {
    const m = build({
      samples: [sample('s1', 'ok'), sample('s2', 'gone'), sample('s3', 'ok')],
      cancelledOrders: ['gone'],
    });
    await expect(m.notes(['s1', 's2', 's3'])).rejects.toBeInstanceOf(
      SampleOrderCancelledException,
    );
    // s3 (after the refusal) was never touched; the write for s1 happens inside
    // the same transaction, which the thrown error rolls back as a whole.
    const updated = m.tx.orderSample.update.mock.calls.map(
      (_c, i) =>
        callArg<{ where: { id: string } }>(m.tx.orderSample.update, i).where.id,
    );
    expect(updated).not.toContain('s2');
    expect(updated).not.toContain('s3');
  });
});

describe('Accession Sample Notes on a normal order are unchanged', () => {
  it('saves the note and writes the history row', async () => {
    const m = build({ samples: [sample('s1', 'o1')] });
    const r = await m.notes(['s1'], { notes: 'hello', attachmentUrl: 'u' });
    expect(r.succeeded).toEqual([{ id: 's1' }]);
    expect(m.tx.orderSampleStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(
      callArg<{ data: Record<string, unknown> }>(
        m.tx.orderSampleStatusHistory.create,
      ).data,
    ).toMatchObject({
      action: 'update',
      fromStatus: SampleStatus.ACCEPTED,
      toStatus: SampleStatus.ACCEPTED,
      notes: 'hello',
      attachmentUrl: 'u',
    });
  });

  it('a group of several samples on a normal order is written for each', async () => {
    const m = build({ samples: [sample('s1', 'o1'), sample('s2', 'o1')] });
    await m.notes(['s1', 's2']);
    expect(m.tx.orderSample.update).toHaveBeenCalledTimes(2);
  });

  it('a sample that is sent to another branch (order not cancelled) still takes a note, as before', async () => {
    const m = build({
      samples: [sample('s1', 'o1', SampleStatus.SENT_INTERNAL)],
    });
    await expect(m.notes(['s1'])).resolves.toBeDefined();
    expect(m.tx.orderSampleStatusHistory.create).toHaveBeenCalledTimes(1);
  });

  it('a missing sample is still "not found"', async () => {
    const m = build({ samples: [] });
    await expect(m.notes(['nope'])).rejects.toThrow();
    m.nothingWritten();
  });
});

describe('Share & Inform on a cancelled order stays allowed', () => {
  it('is recorded, and the order is not even asked about', async () => {
    const m = build({
      samples: [sample('s1', 'o1')],
      cancelledOrders: ['o1'],
    });
    const r = await m.share('s1');
    expect(r).toBeDefined();
    expect(m.tx.orderSampleStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(
      callArg<{ data: Record<string, unknown> }>(
        m.tx.orderSampleStatusHistory.create,
      ).data,
    ).toMatchObject({ action: 'share' });
    expect(m.tx.order.findFirst).not.toHaveBeenCalled();
  });
});
