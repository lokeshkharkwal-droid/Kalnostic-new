import { OrderService } from './order.service';

/**
 * The order Timeline merges, in chronological order: the order's creation, every
 * recorded update (iteration + "Order Updated"), every radiology report-fill,
 * report-approve and report-publish (one per `RadiologyStudyStatusHistory`
 * `report`/`approve`/`publish` row), and every ORDER-level note — all from real
 * persisted data, with per-kind totals.
 */
describe('OrderService — getTimeline', () => {
  const t0 = new Date('2026-01-01T10:00:00Z'); // created
  const t1 = new Date('2026-01-01T11:00:00Z'); // report filled
  const t2 = new Date('2026-01-01T12:00:00Z'); // order updated
  const t2b = new Date('2026-01-01T12:30:00Z'); // report approved (submitted)
  const t3 = new Date('2026-01-01T13:00:00Z'); // report published
  const t4 = new Date('2026-01-01T14:00:00Z'); // note

  const prisma = {
    order: { findFirst: jest.fn() },
    orderNote: { findMany: jest.fn() },
    radiologyStudy: { findMany: jest.fn() },
    radiologyStudyStatusHistory: { findMany: jest.fn() },
    person: { findMany: jest.fn() },
  };
  const deps = Array(13).fill(undefined) as unknown[];
  deps[0] = prisma;
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      createdAt: t0,
      createdBy: 'p1',
      updateHistory: [{ iteration: 1, at: t2.toISOString(), by: 'p2' }],
    });
    prisma.orderNote.findMany.mockResolvedValue([
      {
        id: 'n1',
        body: 'hello',
        createdBy: 'p1',
        createdAt: t4,
        category: 'ORDER',
      },
    ]);
    prisma.radiologyStudy.findMany.mockResolvedValue([
      { id: 's1', studyNo: 'RAD-00001' },
    ]);
    prisma.radiologyStudyStatusHistory.findMany.mockResolvedValue([
      { studyId: 's1', action: 'report', changedBy: 'p2', createdAt: t1 },
      { studyId: 's1', action: 'approve', changedBy: 'p2', createdAt: t2b },
      { studyId: 's1', action: 'publish', changedBy: 'p2', createdAt: t3 },
    ]);
    prisma.person.findMany.mockResolvedValue([]);
  });

  it('merges creation, update, report-fill, approve, report-publish and note chronologically', async () => {
    const tl = await service.getTimeline('o1', 'tenant-1');
    expect(tl.updateCount).toBe(1);
    expect(tl.reportFillCount).toBe(1);
    expect(tl.approveCount).toBe(1);
    expect(tl.publishCount).toBe(1);
    expect(tl.noteCount).toBe(1);
    // t0 < t1 < t2 < t2b < t3 < t4.
    expect(tl.events.map((e) => e.type)).toEqual([
      'CREATED',
      'REPORT_FILLED',
      'UPDATED',
      'REPORT_APPROVED',
      'REPORT_PUBLISHED',
      'NOTE',
    ]);
    expect(tl.events.find((e) => e.type === 'REPORT_FILLED')?.studyNo).toBe(
      'RAD-00001',
    );
    expect(tl.events.find((e) => e.type === 'REPORT_APPROVED')?.studyNo).toBe(
      'RAD-00001',
    );
    expect(tl.events.find((e) => e.type === 'REPORT_APPROVED')?.at).toEqual(
      t2b,
    );
    expect(tl.events.find((e) => e.type === 'REPORT_PUBLISHED')?.studyNo).toBe(
      'RAD-00001',
    );
    expect(tl.events.find((e) => e.type === 'UPDATED')?.iteration).toBe(1);
    // Only the report lifecycle actions are pulled from the status history.
    const findMany = prisma.radiologyStudyStatusHistory
      .findMany as jest.MockedFunction<
      (arg: { where: { action: { in: string[] } } }) => unknown
    >;
    expect(findMany.mock.calls[0]?.[0]?.where.action.in).toEqual([
      'report',
      'approve',
      'publish',
    ]);
  });

  it('records every report-fill and publish occurrence separately', async () => {
    prisma.radiologyStudyStatusHistory.findMany.mockResolvedValue([
      { studyId: 's1', action: 'report', changedBy: 'p2', createdAt: t1 },
      { studyId: 's1', action: 'report', changedBy: 'p2', createdAt: t2 },
      { studyId: 's1', action: 'publish', changedBy: 'p2', createdAt: t3 },
    ]);
    const tl = await service.getTimeline('o1', 'tenant-1');
    expect(tl.reportFillCount).toBe(2);
    expect(tl.publishCount).toBe(1);
    expect(tl.events.filter((e) => e.type === 'REPORT_FILLED')).toHaveLength(2);
    expect(tl.events.filter((e) => e.type === 'REPORT_PUBLISHED')).toHaveLength(
      1,
    );
  });

  it('a never-edited non-radiology order shows only its creation', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      createdAt: t0,
      createdBy: 'p1',
      updateHistory: null,
    });
    prisma.orderNote.findMany.mockResolvedValue([]);
    prisma.radiologyStudy.findMany.mockResolvedValue([]);
    const tl = await service.getTimeline('o1', 'tenant-1');
    expect(tl.events).toHaveLength(1);
    expect(tl.events[0]!.type).toBe('CREATED');
    expect(tl.reportFillCount).toBe(0);
    expect(tl.publishCount).toBe(0);
    // No studies → the status-history table is never queried.
    expect(prisma.radiologyStudyStatusHistory.findMany).not.toHaveBeenCalled();
  });

  it('throws when the order does not exist', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.getTimeline('missing', 'tenant-1')).rejects.toThrow();
  });
});
