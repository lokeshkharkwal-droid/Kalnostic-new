import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';

type Counts = Partial<Record<string, number>>;

const CHILD_TABLES = [
  'labReportResultValue',
  'labReportNote',
  'labReportAttachment',
  'labReportOverallResult',
  'reRunRequest',
  'criticalAlert',
  'outOfRangeFlag',
  'deltaCheck',
  'scheduledTest',
  'multiStepTestProcess',
  'labReportInventoryUsage',
  'tatAdjustment',
] as const;

const CLEAN_REPORT: Record<string, unknown> = {
  status: LabReportStatus.PENDING,
  isLocked: false,
  lockedAt: null,
  usefulFor: null,
  interpretationOfResults: null,
  limitations: null,
  remarks: null,
  references: null,
};

function untouched(
  report: Record<string, unknown> | null,
  counts: Counts = {},
) {
  const tx: Record<string, unknown> = {
    labReport: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          report === null ? null : { ...CLEAN_REPORT, ...report },
        ),
    },
  };
  for (const t of CHILD_TABLES) {
    tx[t] = { count: jest.fn().mockResolvedValue(counts[t] ?? 0) };
  }
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  return svc.isReportUntouched(tx as never, 't1', 'r1');
}

describe('LabReportService.isReportUntouched', () => {
  it('a Pending report with no work anywhere is untouched', async () => {
    expect(await untouched({})).toBe(true);
  });

  it('a report that no longer exists counts as untouched (nothing to lose)', async () => {
    expect(await untouched(null)).toBe(true);
  });

  it.each(Object.values(LabReportStatus).filter((s) => s !== 'PENDING'))(
    'status %s is touched',
    async (status) => {
      expect(await untouched({ status })).toBe(false);
    },
  );

  it('a locked report is touched, even without a lock note', async () => {
    expect(await untouched({ isLocked: true })).toBe(false);
    expect(await untouched({ lockedAt: new Date() })).toBe(false);
  });

  it.each([
    'usefulFor',
    'interpretationOfResults',
    'limitations',
    'remarks',
    'references',
  ])('a Notes-section override (%s) is touched', async (field) => {
    expect(await untouched({ [field]: 'x' })).toBe(false);
  });

  it.each(CHILD_TABLES)(
    'any row in %s makes it touched (even one that was soft-deleted later)',
    async (table) => {
      expect(await untouched({}, { [table]: 1 })).toBe(false);
    },
  );
});

describe('LabReportService.rehomeReportsForAcceptedItem', () => {
  function run(opts: {
    from?: string | null;
    itemBranch?: string | null;
    member?: string | null;
  }) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const itemFind = jest
      .fn()
      .mockResolvedValue({ branchId: opts.itemBranch ?? null });
    const tx = {
      labReport: { updateMany },
      orderItem: { findFirst: itemFind },
    };
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    const done = svc.rehomeReportsForAcceptedItem(
      tx as never,
      't1',
      'item1',
      'B',
      opts.member ?? null,
      opts.from,
    );
    return { done, updateMany, itemFind };
  }

  const whereOf = (updateMany: jest.Mock) =>
    (updateMany.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;

  it('moves only reports still held by the sender or still at the item’s own branch', async () => {
    const { done, updateMany } = run({ from: 'A', itemBranch: 'O' });
    await done;
    expect(whereOf(updateMany).branchId).toEqual({ in: ['A', 'O'] });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { branchId: 'B' } }),
    );
  });

  it('a report that already went to another branch is not in the filter, so it is not moved again', async () => {
    const { done, updateMany } = run({ from: 'A', itemBranch: 'A' });
    await done;
    // report currently at C matches neither A nor the item's branch A
    expect((whereOf(updateMany).branchId as { in: string[] }).in).not.toContain(
      'C',
    );
  });

  it('without a sending branch it behaves as before (no branch condition)', async () => {
    const { done, updateMany, itemFind } = run({ from: undefined });
    await done;
    expect(whereOf(updateMany).branchId).toBeUndefined();
    expect(itemFind).not.toHaveBeenCalled();
  });

  it('still scopes a panel member to its own report', async () => {
    const { done, updateMany } = run({ from: 'A', member: 'lt-1' });
    await done;
    expect(whereOf(updateMany).OR).toEqual([
      { memberBranchLabTestId: null },
      { labTestId: 'lt-1' },
    ]);
  });
});
