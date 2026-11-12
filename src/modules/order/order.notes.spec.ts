import { OrderService } from './order.service';
import type { NoteCounts } from '../../common/utils';

/**
 * Order Console notes: `GET /orders/:id/notes` merges the Order Overview notes,
 * the Technician Reporting notes (read-only, tagged with test + sample) and the
 * accession sample notes; `noteCountsByOrder` (the row icons) must count exactly
 * what that list returns, per category.
 */
describe('OrderService — order notes merged with Technician Reporting notes', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 12, 10, min));

  const ORDER_NOTES = [
    {
      id: 'on-1',
      orderId: 'o1',
      category: 'ORDER',
      body: 'Fasting sample',
      createdBy: 'p-reg',
      createdAt: at(1),
    },
    {
      id: 'on-2',
      orderId: 'o1',
      category: 'TECH',
      body: 'Console tech note',
      createdBy: 'p-reg',
      createdAt: at(5),
    },
  ];
  const LAB_NOTES = [
    {
      id: 'ln-1',
      category: 'SAMPLE',
      body: 'Haemolysed',
      createdBy: 'p-tech',
      createdAt: at(3),
      labReportId: 'r-cbc',
      orderId: 'o1',
    },
    {
      id: 'ln-2',
      category: 'TECH',
      body: 'Re-ran on A2',
      createdBy: 'p-tech',
      createdAt: at(7),
      labReportId: 'r-cbc',
      orderId: 'o1',
    },
    {
      id: 'ln-3',
      category: 'ORDER',
      body: 'Call doctor',
      createdBy: 'p-tech',
      createdAt: at(2),
      labReportId: 'r-cbc',
      orderId: 'o1',
    },
    {
      id: 'ln-4',
      category: 'TECH',
      body: 'Other order',
      createdBy: 'p-tech',
      createdAt: at(2),
      labReportId: 'r-x',
      orderId: 'o2',
    },
  ];
  const HISTORY = [
    {
      id: 'h-1',
      notes: 'Collected late',
      action: 'collect',
      changedBy: 'p-acc',
      createdAt: at(4),
      sample: { orderId: 'o1', sampleName: 'Blood (EDTA)', barcode: '10010' },
    },
  ];

  /** The `where` shapes the service sends (only the fields the mocks read). */
  type IdIn = { in: string[] };
  type NotesArgs = {
    where: {
      orderId: string | IdIn;
      category?: string | IdIn;
      labReport: { orderItem: { orderId: IdIn } };
      sample: { orderId: IdIn };
    };
  };
  const ids = (v: string | IdIn) => (typeof v === 'string' ? [v] : v.in);

  const inCategory = (where: { category?: unknown }, category: string) =>
    where.category === undefined ||
    where.category === category ||
    ((where.category as { in?: string[] }).in ?? []).includes(category);

  const prisma = {
    order: { findFirst: jest.fn().mockResolvedValue({ id: 'o1' }) },
    person: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'p-reg', firstName: 'Riya', middleName: null, lastName: 'Reg' },
        { id: 'p-tech', firstName: 'Tara', middleName: null, lastName: 'Tech' },
        { id: 'p-acc', firstName: 'Arun', middleName: null, lastName: 'Acc' },
      ]),
    },
    orderNote: {
      findMany: jest.fn(({ where }: NotesArgs) =>
        Promise.resolve(
          ORDER_NOTES.filter(
            (n) =>
              ids(where.orderId).includes(n.orderId) &&
              inCategory(where, n.category),
          ),
        ),
      ),
      groupBy: jest.fn(({ where }: NotesArgs) => {
        const groups = new Map<
          string,
          { orderId: string; category: string; _count: { _all: number } }
        >();
        for (const n of ORDER_NOTES.filter((x) =>
          ids(where.orderId).includes(x.orderId),
        )) {
          const key = `${n.orderId}|${n.category}`;
          const g = groups.get(key) ?? {
            orderId: n.orderId,
            category: n.category,
            _count: { _all: 0 },
          };
          g._count._all += 1;
          groups.set(key, g);
        }
        return Promise.resolve([...groups.values()]);
      }),
    },
    labReportNote: {
      findMany: jest.fn(({ where }: NotesArgs) =>
        Promise.resolve(
          LAB_NOTES.filter(
            (n) =>
              where.labReport.orderItem.orderId.in.includes(n.orderId) &&
              inCategory(where, n.category),
          ).map((n) => ({
            ...n,
            labReport: { orderItem: { orderId: n.orderId } },
          })),
        ),
      ),
    },
    labReport: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'r-cbc',
          labTestId: 'lt-cbc',
          memberBranchLabTestId: null,
          orderItemId: 'oi-1',
          orderItem: {
            branchLabTest: { testName: 'CBC' },
            branchLabPanel: null,
          },
        },
      ]),
    },
    branchLabTest: { findMany: jest.fn().mockResolvedValue([]) },
    orderSampleTest: {
      findMany: jest.fn().mockResolvedValue([
        {
          orderItemId: 'oi-1',
          labTestId: 'lt-cbc',
          sample: { sampleName: 'Blood (EDTA)', barcode: '10010' },
        },
      ]),
    },
    orderSampleStatusHistory: {
      findMany: jest.fn(({ where }: NotesArgs) =>
        Promise.resolve(
          HISTORY.filter((h) =>
            where.sample.orderId.in.includes(h.sample.orderId),
          ),
        ),
      ),
    },
  };

  const deps = Array(16).fill(undefined) as unknown[];
  deps[0] = prisma;
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );
  const counts = (orderIds: string[]) =>
    (
      service as unknown as {
        noteCountsByOrder: (
          t: string,
          ids: string[],
        ) => Promise<Map<string, NoteCounts>>;
      }
    ).noteCountsByOrder('t1', orderIds);

  it('lists every source newest-first, technician notes read-only with test + sample', async () => {
    const notes = await service.findNotes('o1', 't1', {});
    expect(notes.map((n) => n.id)).toEqual([
      'ln-2',
      'on-2',
      'h-1',
      'ln-1',
      'ln-3',
      'on-1',
    ]);

    const tech = notes.find((n) => n.id === 'ln-2')!;
    expect(tech).toMatchObject({
      category: 'TECH',
      body: 'Re-ran on A2',
      createdByName: 'Tara Tech',
      source: 'LAB_REPORT',
      readonly: true,
      testName: 'CBC',
      sampleLabel: 'Blood (EDTA) · 10010',
    });
    expect(notes.find((n) => n.id === 'on-1')).toMatchObject({
      source: 'ORDER',
      readonly: false,
    });
    expect(notes.find((n) => n.id === 'h-1')).toMatchObject({
      source: 'ACCESSION',
      readonly: true,
      action: 'collect',
      sampleLabel: 'Blood (EDTA) · 10010',
    });
  });

  it('keeps each tab to its own category (accession notes only on Sample)', async () => {
    const ids = async (category: 'ORDER' | 'SAMPLE' | 'TECH') =>
      (await service.findNotes('o1', 't1', { category })).map((n) => n.id);
    expect(await ids('ORDER')).toEqual(['ln-3', 'on-1']);
    expect(await ids('SAMPLE')).toEqual(['h-1', 'ln-1']);
    expect(await ids('TECH')).toEqual(['ln-2', 'on-2']);
  });

  it('counts per order exactly what the notes list returns', async () => {
    const map = await counts(['o1', 'o2', 'o3']);
    expect(map.get('o1')).toEqual({ ORDER: 2, SAMPLE: 2, TECH: 2 });
    expect(map.get('o2')).toEqual({ ORDER: 0, SAMPLE: 0, TECH: 1 });
    expect(map.get('o3')).toEqual({ ORDER: 0, SAMPLE: 0, TECH: 0 });

    for (const category of ['ORDER', 'SAMPLE', 'TECH'] as const) {
      const listed = await service.findNotes('o1', 't1', { category });
      expect(map.get('o1')![category]).toBe(listed.length);
    }
  });

  it('makes no query for an empty page', async () => {
    prisma.orderNote.groupBy.mockClear();
    expect((await counts([])).size).toBe(0);
    expect(prisma.orderNote.groupBy).not.toHaveBeenCalled();
  });
});
