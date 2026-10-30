import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';

type Counts = Partial<Record<string, number>>;

const CHILD_TABLES = [
  'labReportResultValue',
  'labReportNote',
  'labReportAttachment',
  'labReportOverallResult',
  'labReportParameterNote',
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

function setup(
  report: Record<string, unknown> | null,
  counts: Counts = {},
  returnedAt: Date | null = null,
) {
  const tx: Record<string, unknown> = {
    labReport: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          report === null ? null : { ...CLEAN_REPORT, ...report },
        ),
    },
    labReportHistory: {
      findFirst: jest
        .fn()
        .mockResolvedValue(returnedAt ? { createdAt: returnedAt } : null),
    },
  };
  for (const t of CHILD_TABLES) {
    tx[t] = { count: jest.fn().mockResolvedValue(counts[t] ?? 0) };
  }
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  return { tx, svc, run: () => svc.isReportUntouched(tx as never, 't1', 'r1') };
}

function untouched(
  report: Record<string, unknown> | null,
  counts: Counts = {},
  returnedAt: Date | null = null,
) {
  return setup(report, counts, returnedAt).run();
}

/** The `where` a child table's count was asked with. */
function whereOf(tx: Record<string, unknown>, table: string) {
  const count = (tx[table] as { count: jest.Mock }).count;
  return (count.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;
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

describe('LabReportService.isReportUntouched - a report returned for repeat starts a new cycle', () => {
  const RETURNED = new Date('2026-10-06T10:00:00Z');

  it('never returned: every row counts, including soft-deleted ones (strict, unchanged)', async () => {
    const { tx, run } = setup({});
    await run();
    for (const table of CHILD_TABLES) {
      // Notes are the one exception: the system's own LOCK / UNLOCK notes never count
      // (see the dedicated tests below).
      expect(whereOf(tx, table)).toEqual(
        table === 'labReportNote'
          ? { labReportId: 'r1', category: { notIn: ['LOCK', 'UNLOCK'] } }
          : { labReportId: 'r1' },
      );
    }
  });

  it('never returned: a lock / unlock cycle is not work - its LOCK and UNLOCK notes are ignored', async () => {
    const { tx, run } = setup({});
    await run();
    expect(whereOf(tx, 'labReportNote')).toMatchObject({
      category: { notIn: ['LOCK', 'UNLOCK'] },
    });
    // Any other note (ORDER, SAMPLE, TECH, ...) still counts: nothing narrows it.
    const where = whereOf(tx, 'labReportNote');
    expect(where).not.toHaveProperty('OR');
    expect(where).not.toHaveProperty('deletedAt');
  });

  it('returned: LOCK / UNLOCK notes are ignored there too, even ones written after the return', async () => {
    const { tx, run } = setup({}, {}, RETURNED);
    await run();
    expect(whereOf(tx, 'labReportNote')).toMatchObject({
      category: { notIn: ['LOCK', 'UNLOCK'] },
    });
  });

  it('a report that was only locked and unlocked is untouched (the sender may send it)', async () => {
    // Its only notes are the LOCK / UNLOCK pair, which the count query excludes, so
    // every child table counts zero rows.
    expect(await untouched({})).toBe(true);
  });

  it('but a report that is locked right now is still touched', async () => {
    expect(await untouched({ isLocked: true })).toBe(false);
  });

  it('and any other note still makes it touched', async () => {
    expect(await untouched({}, { labReportNote: 1 })).toBe(false);
  });

  it.each([
    'labReportResultValue',
    'labReportOverallResult',
    'labReportParameterNote',
    'reRunRequest',
    'criticalAlert',
    'outOfRangeFlag',
    'deltaCheck',
    'scheduledTest',
    'multiStepTestProcess',
    'tatAdjustment',
  ])(
    'returned: %s counts only live rows or rows created after the return',
    async (table) => {
      const { tx, run } = setup({}, {}, RETURNED);
      await run();
      expect(whereOf(tx, table)).toEqual({
        labReportId: 'r1',
        OR: [{ deletedAt: null }, { createdAt: { gt: RETURNED } }],
      });
    },
  );

  it('returned: attachments use their upload time', async () => {
    const { tx, run } = setup({}, {}, RETURNED);
    await run();
    expect(whereOf(tx, 'labReportAttachment')).toEqual({
      labReportId: 'r1',
      OR: [{ deletedAt: null }, { uploadedAt: { gt: RETURNED } }],
    });
  });

  it('returned: the notes the return kept (ORDER / SAMPLE) only count when new', async () => {
    const { tx, run } = setup({}, {}, RETURNED);
    await run();
    const where = whereOf(tx, 'labReportNote') as {
      OR: Array<{ category?: { in: string[] }; createdAt?: unknown }>;
    };
    const live = where.OR.find((c) => c.category);
    expect(live?.category?.in).not.toContain('ORDER');
    expect(live?.category?.in).not.toContain('SAMPLE');
    expect(where.OR).toContainEqual({ createdAt: { gt: RETURNED } });
  });

  it('returned: the reagent usage the return kept only counts when new', async () => {
    const { tx, run } = setup({}, {}, RETURNED);
    await run();
    expect(whereOf(tx, 'labReportInventoryUsage')).toEqual({
      labReportId: 'r1',
      createdAt: { gt: RETURNED },
    });
  });

  it('returned: new work after the return still makes it touched', async () => {
    expect(await untouched({}, { labReportResultValue: 1 }, RETURNED)).toBe(
      false,
    );
  });

  it('returned: status, lock and the Notes-section texts are judged as before', async () => {
    expect(await untouched({ status: 'SAVED' }, {}, RETURNED)).toBe(false);
    expect(await untouched({ isLocked: true }, {}, RETURNED)).toBe(false);
    expect(await untouched({ remarks: 'x' }, {}, RETURNED)).toBe(false);
  });

  it('returned and clean: untouched, so the sender can send it again', async () => {
    expect(await untouched({}, {}, RETURNED)).toBe(true);
  });
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
