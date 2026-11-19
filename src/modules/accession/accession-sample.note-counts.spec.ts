import { OrderSampleService } from './accession-sample.service';
import { noteCountsBySample } from '../../common/utils';
import type { InHouseOrderGroup } from './entities/accession-sample.entity';

jest.mock('../../common/utils', () => ({
  ...jest.requireActual<object>('../../common/utils'),
  noteCountsBySample: jest.fn(),
}));

/**
 * In-House list (`GET /accession/order-samples/grouped?includeNoteCounts=true`):
 * every listed sample gets its own Sample / Tech note counts (the Sample Status
 * column's notes icons), computed once for the whole page.
 */
describe('OrderSampleService — per-sample note counts on the In-House list', () => {
  const counts = noteCountsBySample as jest.MockedFunction<
    typeof noteCountsBySample
  >;
  const tx = { marker: 'tx' };
  const prisma = {
    withTenant: jest.fn((_t: string, fn: (db: unknown) => unknown) => fn(tx)),
  };
  const deps = Array(10).fill(undefined) as unknown[];
  deps[0] = prisma;
  const service = new OrderSampleService(
    ...(deps as ConstructorParameters<typeof OrderSampleService>),
  );
  const attach = (groups: InHouseOrderGroup[]) =>
    (
      service as unknown as {
        attachSampleNoteCounts: (
          t: string,
          g: InHouseOrderGroup[],
        ) => Promise<void>;
      }
    ).attachSampleNoteCounts('t1', groups);

  const sample = (id: string, orderId: string) => ({ id, orderId });
  const group = (orderId: string, ...sampleGroups: { id: string }[][]) =>
    ({
      orderId,
      groups: sampleGroups.map((samples) => ({
        samples: samples.map((s) => sample(s.id, orderId)),
      })),
    }) as unknown as InHouseOrderGroup;

  beforeEach(() => {
    counts.mockReset();
    prisma.withTenant.mockClear();
  });

  it("puts each sample's own counts on it, in one batched call for the page", async () => {
    counts.mockResolvedValue(
      new Map([
        ['s-a', { SAMPLE: 2, TECH: 1 }],
        ['s-b', { SAMPLE: 0, TECH: 3 }],
      ]),
    );
    const page = [
      group('o1', [{ id: 's-a' }], [{ id: 's-b' }]),
      group('o2', [{ id: 's-c' }]),
    ];
    await attach(page);

    expect(counts).toHaveBeenCalledTimes(1);
    expect(counts).toHaveBeenCalledWith(tx, 't1', [
      { id: 's-a', orderId: 'o1' },
      { id: 's-b', orderId: 'o1' },
      { id: 's-c', orderId: 'o2' },
    ]);
    const noteCounts = page.flatMap((o) =>
      o.groups.flatMap((g) => g.samples.map((s) => [s.id, s.noteCounts])),
    );
    expect(noteCounts).toEqual([
      ['s-a', { SAMPLE: 2, TECH: 1 }],
      ['s-b', { SAMPLE: 0, TECH: 3 }],
      // absent from the map → zero, never undefined
      ['s-c', { SAMPLE: 0, TECH: 0 }],
    ]);
  });

  it('makes no query for an empty page', async () => {
    await attach([]);
    expect(counts).not.toHaveBeenCalled();
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });
});
