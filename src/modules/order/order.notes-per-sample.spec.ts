import { OrderService } from './order.service';
import { noteCountsBySample } from '../../common/utils';

/**
 * In-House Orders → Sample Status notes icons: `GET /orders/:id/notes?sampleId=`
 * narrows the order's notes to ONE sample, and `noteCountsBySample` (the
 * `includeNoteCounts` counts on `/accession/order-samples/grouped`) must count
 * exactly what that list returns, per sample and category.
 *
 * Order o1 has three samples:
 * - s-a Blood (EDTA): standalone CBC (oi-1) + the Profile test (oi-4)
 * - s-b Urine: the panel member Urine Routine (oi-2, lt-uri)
 * - s-c Fluoride: the panel member Glucose (oi-2, lt-glu) + the Profile test (oi-4)
 * so a panel-member report only uses its own member's sample, and the Profile
 * report (oi-4) is linked to two samples.
 */
describe('OrderService — notes narrowed to one sample (In-House Sample Status)', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 13, 10, min));

  const SAMPLES = [
    { id: 's-a', orderId: 'o1', sampleName: 'Blood (EDTA)', barcode: '100' },
    { id: 's-b', orderId: 'o1', sampleName: 'Urine', barcode: '101' },
    { id: 's-c', orderId: 'o1', sampleName: 'Fluoride', barcode: '102' },
    { id: 's-x', orderId: 'o2', sampleName: 'Serum', barcode: '200' },
  ];
  const SAMPLE_TESTS = [
    { sampleId: 's-a', orderItemId: 'oi-1', labTestId: 'lt-cbc' },
    { sampleId: 's-b', orderItemId: 'oi-2', labTestId: 'lt-uri' },
    { sampleId: 's-c', orderItemId: 'oi-2', labTestId: 'lt-glu' },
    { sampleId: 's-a', orderItemId: 'oi-4', labTestId: 'lt-prof' },
    { sampleId: 's-c', orderItemId: 'oi-4', labTestId: 'lt-prof' },
    { sampleId: 's-x', orderItemId: 'oi-9', labTestId: 'lt-ser' },
  ];
  const REPORTS = [
    {
      id: 'r-cbc',
      orderId: 'o1',
      orderItemId: 'oi-1',
      labTestId: 'lt-cbc',
      memberBranchLabTestId: null,
    },
    {
      id: 'r-uri',
      orderId: 'o1',
      orderItemId: 'oi-2',
      labTestId: 'lt-uri',
      memberBranchLabTestId: 'bm-uri',
    },
    {
      id: 'r-glu',
      orderId: 'o1',
      orderItemId: 'oi-2',
      labTestId: 'lt-glu',
      memberBranchLabTestId: 'bm-glu',
    },
    {
      id: 'r-prof',
      orderId: 'o1',
      orderItemId: 'oi-4',
      labTestId: 'lt-prof',
      memberBranchLabTestId: null,
    },
    {
      id: 'r-ser',
      orderId: 'o2',
      orderItemId: 'oi-9',
      labTestId: 'lt-ser',
      memberBranchLabTestId: null,
    },
  ];
  /** Order Overview notes: saved against the whole order (no sample). */
  const ORDER_NOTES = [
    {
      id: 'on-1',
      orderId: 'o1',
      category: 'ORDER',
      body: 'Fasting',
      createdBy: 'p1',
      createdAt: at(1),
    },
    {
      id: 'on-2',
      orderId: 'o1',
      category: 'SAMPLE',
      body: 'Order-wide sample note',
      createdBy: 'p1',
      createdAt: at(2),
    },
    {
      id: 'on-3',
      orderId: 'o1',
      category: 'TECH',
      body: 'Order-wide tech note',
      createdBy: 'p1',
      createdAt: at(3),
    },
    {
      id: 'on-9',
      orderId: 'o2',
      category: 'SAMPLE',
      body: 'Other order',
      createdBy: 'p1',
      createdAt: at(4),
    },
  ];
  /** Technician Reporting notes, each on one report. */
  const LAB_NOTES = [
    {
      id: 'ln-1',
      labReportId: 'r-cbc',
      category: 'TECH',
      body: 'CBC rerun',
      createdBy: 'p1',
      createdAt: at(5),
    },
    {
      id: 'ln-2',
      labReportId: 'r-uri',
      category: 'SAMPLE',
      body: 'Turbid',
      createdBy: 'p1',
      createdAt: at(6),
    },
    {
      id: 'ln-3',
      labReportId: 'r-glu',
      category: 'TECH',
      body: 'Glucose flag',
      createdBy: 'p1',
      createdAt: at(7),
    },
    {
      id: 'ln-4',
      labReportId: 'r-prof',
      category: 'TECH',
      body: 'Profile note',
      createdBy: 'p1',
      createdAt: at(8),
    },
    {
      id: 'ln-5',
      labReportId: 'r-cbc',
      category: 'ORDER',
      body: 'Call doctor',
      createdBy: 'p1',
      createdAt: at(9),
    },
    {
      id: 'ln-9',
      labReportId: 'r-ser',
      category: 'TECH',
      body: 'Other order',
      createdBy: 'p1',
      createdAt: at(10),
    },
  ];
  /** Accession notes, each on its own sample. */
  const HISTORY = [
    {
      id: 'h-1',
      sampleId: 's-b',
      notes: 'Collected late',
      action: 'collect',
      changedBy: 'p1',
      createdAt: at(11),
    },
    {
      id: 'h-2',
      sampleId: 's-a',
      notes: 'Re-labelled',
      action: 'update',
      changedBy: 'p1',
      createdAt: at(12),
    },
    {
      id: 'h-9',
      sampleId: 's-x',
      notes: 'Other order',
      action: 'collect',
      changedBy: 'p1',
      createdAt: at(13),
    },
  ];

  type Filter = string | { in: string[] } | undefined;
  /** A Prisma scalar filter: absent, an exact value or `{ in: [...] }`. */
  const matches = (filter: Filter, value: string) =>
    filter === undefined ||
    (typeof filter === 'string' ? filter === value : filter.in.includes(value));
  type Where = {
    id?: Filter;
    orderId?: Filter;
    sampleId?: Filter;
    orderItemId?: Filter;
    category?: Filter;
    labReport?: { orderItem: { orderId: Filter } };
    sample?: { orderId: Filter };
  };
  const reportById = new Map(REPORTS.map((r) => [r.id, r]));
  const sampleById = new Map(SAMPLES.map((s) => [s.id, s]));

  const labNotes = ({ where }: { where: Where }) =>
    LAB_NOTES.filter(
      (n) =>
        matches(where.category, n.category) &&
        matches(
          where.labReport?.orderItem.orderId,
          reportById.get(n.labReportId)!.orderId,
        ),
    );
  const history = ({ where }: { where: Where }) =>
    HISTORY.filter(
      (h) =>
        matches(where.sampleId, h.sampleId) &&
        matches(where.sample?.orderId, sampleById.get(h.sampleId)!.orderId),
    ).map((h) => ({ ...h, sample: sampleById.get(h.sampleId)! }));
  const orderNotes = ({ where }: { where: Where }) =>
    ORDER_NOTES.filter(
      (n) =>
        matches(where.orderId, n.orderId) &&
        matches(where.category, n.category),
    );
  /** `groupBy` over rows, counting `_count._all` per distinct key tuple. */
  const groupBy = <T extends Record<string, unknown>>(
    rows: T[],
    by: (keyof T)[],
  ) => {
    const groups = new Map<
      string,
      Record<string, unknown> & { _count: { _all: number } }
    >();
    for (const row of rows) {
      const key = by.map((k) => String(row[k])).join('|');
      const g = groups.get(key) ?? {
        ...Object.fromEntries(by.map((k) => [k, row[k]])),
        _count: { _all: 0 },
      };
      g._count._all += 1;
      groups.set(key, g);
    }
    return [...groups.values()];
  };

  const prisma = {
    order: { findFirst: jest.fn().mockResolvedValue({ id: 'o1' }) },
    orderSample: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; orderId: string } }) =>
          Promise.resolve(
            SAMPLES.find(
              (s) => s.id === where.id && s.orderId === where.orderId,
            ) ?? null,
          ),
      ),
    },
    person: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'p1', firstName: 'Tara', middleName: null, lastName: 'Tech' },
        ]),
    },
    orderNote: {
      findMany: jest.fn((args: { where: Where }) =>
        Promise.resolve(orderNotes(args)),
      ),
      groupBy: jest.fn((args: { where: Where }) =>
        Promise.resolve(groupBy(orderNotes(args), ['orderId', 'category'])),
      ),
    },
    labReportNote: {
      findMany: jest.fn((args: { where: Where }) =>
        Promise.resolve(labNotes(args)),
      ),
    },
    labReport: {
      findMany: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(
          REPORTS.filter((r) => matches(where.id, r.id)).map((r) => ({
            ...r,
            orderItem: {
              branchLabTest: { testName: r.labTestId },
              branchLabPanel: null,
            },
          })),
        ),
      ),
    },
    branchLabTest: { findMany: jest.fn().mockResolvedValue([]) },
    orderSampleTest: {
      findMany: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(
          SAMPLE_TESTS.filter((st) =>
            matches(where.orderItemId, st.orderItemId),
          ).map((st) => ({
            ...st,
            sample: sampleById.get(st.sampleId)!,
          })),
        ),
      ),
    },
    orderSampleStatusHistory: {
      findMany: jest.fn((args: { where: Where }) =>
        Promise.resolve(history(args)),
      ),
      groupBy: jest.fn((args: { where: Where }) =>
        Promise.resolve(groupBy(history(args), ['sampleId'])),
      ),
    },
  };

  const deps = Array(16).fill(undefined) as unknown[];
  deps[0] = prisma;
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );
  const listed = async (
    sampleId: string,
    category: 'ORDER' | 'SAMPLE' | 'TECH',
  ) =>
    (await service.findNotes('o1', 't1', { category, sampleId }))
      .map((n) => n.id)
      .sort();
  const db = prisma as unknown as Parameters<typeof noteCountsBySample>[0];
  const o1Samples = SAMPLES.filter((s) => s.orderId === 'o1');

  it("lists only the sample's own Technician + accession notes, plus the order-wide notes", async () => {
    expect(await listed('s-a', 'SAMPLE')).toEqual(['h-2', 'on-2']);
    expect(await listed('s-a', 'TECH')).toEqual(['ln-1', 'ln-4', 'on-3']);
    expect(await listed('s-b', 'SAMPLE')).toEqual(['h-1', 'ln-2', 'on-2']);
    expect(await listed('s-b', 'TECH')).toEqual(['on-3']);
    expect(await listed('s-c', 'SAMPLE')).toEqual(['on-2']);
    expect(await listed('s-c', 'TECH')).toEqual(['ln-3', 'ln-4', 'on-3']);
  });

  it('keeps each note tagged with its source (order-wide notes are source ORDER)', async () => {
    const notes = await service.findNotes('o1', 't1', {
      category: 'SAMPLE',
      sampleId: 's-b',
    });
    expect(notes.find((n) => n.id === 'on-2')).toMatchObject({
      source: 'ORDER',
      readonly: false,
    });
    expect(notes.find((n) => n.id === 'ln-2')).toMatchObject({
      source: 'LAB_REPORT',
      readonly: true,
      sampleLabel: 'Urine · 101',
    });
    expect(notes.find((n) => n.id === 'h-1')).toMatchObject({
      source: 'ACCESSION',
      action: 'collect',
      sampleLabel: 'Urine · 101',
    });
  });

  it('returns nothing for a sample that is not a live sample of the order', async () => {
    expect(
      await service.findNotes('o1', 't1', {
        category: 'SAMPLE',
        sampleId: 's-x',
      }),
    ).toEqual([]);
    expect(
      await service.findNotes('o1', 't1', { sampleId: 's-missing' }),
    ).toEqual([]);
  });

  it('leaves the unfiltered order-wide list unchanged', async () => {
    const all = (await service.findNotes('o1', 't1', { category: 'TECH' }))
      .map((n) => n.id)
      .sort();
    expect(all).toEqual(['ln-1', 'ln-3', 'ln-4', 'on-3']);
  });

  it('counts per sample exactly what the narrowed list returns', async () => {
    const counts = await noteCountsBySample(db, 't1', o1Samples);
    expect(counts.get('s-a')).toEqual({ SAMPLE: 2, TECH: 3 });
    expect(counts.get('s-b')).toEqual({ SAMPLE: 3, TECH: 1 });
    expect(counts.get('s-c')).toEqual({ SAMPLE: 1, TECH: 3 });
    for (const s of o1Samples) {
      for (const category of ['SAMPLE', 'TECH'] as const) {
        expect(counts.get(s.id)![category]).toBe(
          (await listed(s.id, category)).length,
        );
      }
    }
  });

  it('counts samples of several orders in one page without mixing them', async () => {
    const counts = await noteCountsBySample(db, 't1', SAMPLES);
    expect(counts.get('s-x')).toEqual({ SAMPLE: 2, TECH: 1 });
    expect(counts.get('s-a')).toEqual({ SAMPLE: 2, TECH: 3 });
  });

  it('makes no query for an empty page', async () => {
    prisma.orderNote.groupBy.mockClear();
    expect((await noteCountsBySample(db, 't1', [])).size).toBe(0);
    expect(prisma.orderNote.groupBy).not.toHaveBeenCalled();
  });
});
