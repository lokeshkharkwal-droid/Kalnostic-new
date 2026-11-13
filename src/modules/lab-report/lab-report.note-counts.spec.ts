import { LabReportService } from './lab-report.service';
import type { LabReportWorklistRow } from './entities/lab-report.entity';

/**
 * Worklist notes icons (beside Report Status): every row counts the Order /
 * Sample / Tech notes `GET /lab-reports/:id/notes` would list for it - all live
 * reports of the row's order in the branch holding the row's report - in one
 * query for the whole page.
 */
describe('LabReportService — worklist note counts', () => {
  const NOTES = [
    {
      category: 'SAMPLE',
      labReport: { branchId: 'b1', orderItem: { orderId: 'o1' } },
    },
    {
      category: 'TECH',
      labReport: { branchId: 'b1', orderItem: { orderId: 'o1' } },
    },
    {
      category: 'TECH',
      labReport: { branchId: 'b1', orderItem: { orderId: 'o1' } },
    },
    {
      category: 'ORDER',
      labReport: { branchId: 'b1', orderItem: { orderId: 'o1' } },
    },
    // same order, a report held by another branch: not this branch's notes
    {
      category: 'SAMPLE',
      labReport: { branchId: 'b2', orderItem: { orderId: 'o1' } },
    },
  ];
  type FindManyArgs = {
    where: {
      category: { in: string[] };
      deletedAt: null;
      labReport: { orderItem: { orderId: { in: string[] } } };
    };
  };
  const findMany = jest
    .fn<Promise<typeof NOTES>, [FindManyArgs]>()
    .mockResolvedValue(NOTES);
  const deps = Array(11).fill(undefined) as unknown[];
  deps[0] = { labReportNote: { findMany } };
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  const attach = (rows: Partial<LabReportWorklistRow>[]) =>
    (
      service as unknown as {
        attachNoteCounts: (
          t: string,
          rows: Partial<LabReportWorklistRow>[],
        ) => Promise<LabReportWorklistRow[]>;
      }
    ).attachNoteCounts('t1', rows);

  const row = (id: string, orderId: string | null, branchId: string) =>
    ({
      id,
      branchId,
      order: orderId
        ? ({ id: orderId } as LabReportWorklistRow['order'])
        : null,
    }) as Partial<LabReportWorklistRow>;

  beforeEach(() => findMany.mockClear());

  it('gives every test of the order the same order-wide counts, per branch', async () => {
    const out = await attach([
      row('r-cbc', 'o1', 'b1'),
      row('r-esr', 'o1', 'b1'),
      row('r-recv', 'o1', 'b2'),
      row('r-none', 'o2', 'b1'),
      row('r-orphan', null, 'b1'),
    ]);
    expect(out.map((r) => r.noteCounts)).toEqual([
      { ORDER: 1, SAMPLE: 1, TECH: 2 },
      { ORDER: 1, SAMPLE: 1, TECH: 2 },
      { ORDER: 0, SAMPLE: 1, TECH: 0 },
      { ORDER: 0, SAMPLE: 0, TECH: 0 },
      { ORDER: 0, SAMPLE: 0, TECH: 0 },
    ]);
    // rows sharing an order never share one counts object
    expect(out[0]!.noteCounts).not.toBe(out[1]!.noteCounts);
  });

  it('runs one query for the page, scoped to its orders and the plain categories', async () => {
    await attach([
      row('r1', 'o1', 'b1'),
      row('r2', 'o2', 'b1'),
      row('r3', 'o1', 'b1'),
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0]![0].where;
    expect(where.category).toEqual({ in: ['ORDER', 'SAMPLE', 'TECH'] });
    expect(where.deletedAt).toBeNull();
    expect(where.labReport.orderItem.orderId.in).toEqual(['o1', 'o2']);
  });

  it('makes no query when no row has an order', async () => {
    const out = await attach([row('r1', null, 'b1')]);
    expect(findMany).not.toHaveBeenCalled();
    expect(out[0]!.noteCounts).toEqual({ ORDER: 0, SAMPLE: 0, TECH: 0 });
  });
});
