import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';

/**
 * The sample audit trail lists status MOVES, plus a few named lines that change no status but must be visible: the barcode a
 * Repeat took off, put back by a Retrieve, or not put back (every one of them, however many times the sample is repeated), and
 * the note of a Re-run with a fresh sample on a tube that keeps its status (an outsourced tube). Other no-status-change lines
 * (an assigned barcode, an edited note) stay hidden.
 */
const row = (id: string, action: string, from: SampleStatus, to: SampleStatus, minute: number) => ({
  id,
  action,
  fromStatus: from,
  toStatus: to,
  createdAt: new Date(Date.UTC(2026, 10, 10, 10, minute)),
});

async function trailOf(rows: ReturnType<typeof row>[]) {
  const prisma = {
    orderSampleStatusHistory: { findMany: jest.fn().mockResolvedValue(rows) },
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
  const priv = service as unknown as Record<string, unknown>;
  priv.findById = jest.fn().mockResolvedValue({ id: 's1' });
  priv.orderCancelledEntry = jest.fn().mockResolvedValue(null);
  priv.enrichHistoryActors = jest.fn((r: unknown[]) => Promise.resolve(r));
  return ((await service.findHistory('s1', 't1', 'A')) as Array<{ id: string }>).map((r) => r.id);
}

const R = SampleStatus.REPEAT;
const A = SampleStatus.ACCEPTED;
const O = SampleStatus.OUTSOURCED;

describe('findHistory shows the barcode and Re-run lines', () => {
  it.each(['barcode-removed', 'barcode-restored', 'barcode-restore-skipped'])(
    'shows %s although it changes no status',
    async (action) => {
      expect(await trailOf([row('h1', action, R, R, 2), row('h0', 'repeat', A, R, 1)])).toEqual(['h1', 'h0']);
    },
  );

  it('shows the Re-run note of a tube that keeps its status (an outsourced tube)', async () => {
    expect(await trailOf([row('h1', 're-run-fresh', O, O, 2), row('h0', 'outsource', A, O, 1)])).toEqual(['h1', 'h0']);
  });

  it('keeps every removed barcode: three Repeats leave three lines', async () => {
    const ids = await trailOf([
      row('r3', 'barcode-removed', R, R, 9),
      row('r2', 'barcode-removed', R, R, 6),
      row('r1', 'barcode-removed', R, R, 3),
    ]);
    expect(ids).toEqual(['r3', 'r2', 'r1']);
  });

  it('still hides the other no-status-change lines', async () => {
    expect(
      await trailOf([
        row('h1', 'assign-barcode', A, A, 3),
        row('h2', 'update', A, A, 2),
        row('h3', 'accept', SampleStatus.COLLECTED, A, 1),
      ]),
    ).toEqual(['h3']);
  });
});
