import type { WorklistBranchScope } from './access/worklist-branch-scope';
import type { LabReportWorklistRow } from './entities/lab-report.entity';
import { LabReportService } from './lab-report.service';

/**
 * `attachDisplayBranch` fills the worklist's Branch column for the CALLER: the branch that
 * sent the caller's own copy of the sample (or the caller's own branch for an original),
 * while `branch` stays the branch that holds the report. Mocked database; the rule itself is
 * covered by `utils/display-branch.util.spec.ts`.
 */
describe('LabReportService.attachDisplayBranch', () => {
  const TENANT = 't1';
  const A = 'branch-A';
  const B = 'branch-B';
  const C = 'branch-C';
  const NAMES: Record<string, string> = {
    [A]: 'Main',
    [B]: 'North',
    [C]: 'South',
  };

  // The chain A -> B -> C: A's original, B's copy (sent by A), C's copy (sent by B).
  const SAMPLES = [
    {
      id: 's-A',
      branchId: A,
      createdAt: new Date('2026-10-01'),
      sourceTransferId: null,
    },
    {
      id: 's-B',
      branchId: B,
      createdAt: new Date('2026-10-02'),
      sourceTransferId: 'tr-AB',
    },
    {
      id: 's-C',
      branchId: C,
      createdAt: new Date('2026-10-03'),
      sourceTransferId: 'tr-BC',
    },
  ];
  const TRANSFERS = [
    { id: 'tr-AB', branchId: A },
    { id: 'tr-BC', branchId: B },
  ];

  const build = (samples = SAMPLES) => {
    const orderSample = {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(samples.filter((s) => where.id.in.includes(s.id))),
      ),
    };
    const sampleTransfer = {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(TRANSFERS.filter((t) => where.id.in.includes(t.id))),
      ),
    };
    const branch = {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in.map((id) => ({ id, name: NAMES[id] ?? id })),
        ),
      ),
    };
    const deps = Array(11).fill(undefined) as unknown[];
    deps[0] = { orderSample, sampleTransfer, branch };
    const service = new LabReportService(
      ...(deps as ConstructorParameters<typeof LabReportService>),
    );
    const run = (
      viewer: string[],
      rows: Array<Partial<LabReportWorklistRow>>,
    ): Promise<LabReportWorklistRow[]> =>
      (
        service as unknown as {
          attachDisplayBranch: (
            tenantId: string,
            scope: WorklistBranchScope,
            rows: LabReportWorklistRow[],
          ) => Promise<LabReportWorklistRow[]>;
        }
      ).attachDisplayBranch(
        TENANT,
        { rules: viewer.map((branchId) => ({ branchId, statuses: 'ALL' })) },
        rows as LabReportWorklistRow[],
      );
    return { run, orderSample, sampleTransfer, branch };
  };

  // The one report of the chain, as the worklist returns it (held by C).
  const row = (
    over: Partial<LabReportWorklistRow> = {},
  ): Partial<LabReportWorklistRow> => ({
    id: 'r1',
    branchId: C,
    branch: { id: C, name: 'South' },
    sampleIds: ['s-A', 's-B', 's-C'],
    displayBranch: null, // what `toWorklistRow` starts every row with
    ...over,
  });
  const shown = (rows: LabReportWorklistRow[]) =>
    rows[0]?.displayBranch?.name ?? null;

  it("A's worklist shows A", async () => {
    expect(shown(await build().run([A], [row()]))).toBe('Main');
  });

  it("B's worklist shows A (B's copy was sent by A)", async () => {
    expect(shown(await build().run([B], [row()]))).toBe('Main');
  });

  it("C's worklist shows B (C's copy was sent by B), while `branch` stays C", async () => {
    const [out] = await build().run([C], [row()]);
    expect(out!.displayBranch).toEqual({ id: B, name: 'North' });
    expect(out!.branch).toEqual({ id: C, name: 'South' });
    expect(out!.branchId).toBe(C);
  });

  it('never changes branchId (permissions and scoping use it)', async () => {
    for (const viewer of [A, B, C]) {
      const [out] = await build().run([viewer], [row()]);
      expect(out!.branchId).toBe(C);
    }
  });

  it('a report that was never transferred shows the holder branch itself', async () => {
    const [out] = await build().run(
      [A],
      [
        row({
          branchId: A,
          branch: { id: A, name: 'Main' },
          sampleIds: ['s-A'],
        }),
      ],
    );
    expect(out!.displayBranch).toEqual({ id: A, name: 'Main' });
  });

  it("a caller that holds none of the row's samples gets null (the screen falls back to `branch`)", async () => {
    const [out] = await build().run(
      [C],
      [row({ sampleIds: ['s-A', 's-B'], branchId: B })],
    );
    expect(out!.displayBranch).toBeNull();
  });

  it('"All Branches": the holder\'s own sample decides', async () => {
    expect(shown(await build().run([A, B, C], [row()]))).toBe('North');
  });

  it('resolves each row of a page on its own', async () => {
    const out = await build().run(
      [B],
      [
        row({ id: 'r1' }),
        row({
          id: 'r2',
          sampleIds: ['s-B'],
          branchId: B,
          branch: { id: B, name: 'North' },
        }),
      ],
    );
    expect(out.map((r) => r.displayBranch?.name)).toEqual(['Main', 'Main']);
  });

  describe('queries', () => {
    it('does nothing (no queries) for rows without samples', async () => {
      const m = build();
      const rows = [row({ sampleIds: [] })];
      expect(await m.run([A], rows)).toBe(rows);
      expect(m.orderSample.findMany).not.toHaveBeenCalled();
      expect(m.branch.findMany).not.toHaveBeenCalled();
    });

    it('is one batched lookup per table for the whole page, scoped to the tenant', async () => {
      const m = build();
      await m.run(
        [B],
        [row({ id: 'r1' }), row({ id: 'r2' }), row({ id: 'r3' })],
      );
      expect(m.orderSample.findMany).toHaveBeenCalledTimes(1);
      expect(m.sampleTransfer.findMany).toHaveBeenCalledTimes(1);
      expect(m.branch.findMany).toHaveBeenCalledTimes(1);
      for (const call of [
        m.orderSample.findMany.mock.calls[0]![0],
        m.sampleTransfer.findMany.mock.calls[0]![0],
        m.branch.findMany.mock.calls[0]![0],
      ]) {
        expect(call.where).toMatchObject({ tenantId: TENANT });
      }
      expect(m.orderSample.findMany.mock.calls[0]![0].where).toMatchObject({
        deletedAt: null,
      });
    });

    it('skips the transfer lookup when no sample is a copy', async () => {
      const m = build([SAMPLES[0]!]);
      await m.run([A], [row({ branchId: A, sampleIds: ['s-A'] })]);
      expect(m.sampleTransfer.findMany).not.toHaveBeenCalled();
    });

    it('a sample that is no longer live (voided copy) is simply not considered', async () => {
      const m = build([SAMPLES[0]!, SAMPLES[1]!]); // C's copy was voided: not returned by the query
      const [out] = await m.run([C], [row()]);
      expect(out!.displayBranch).toBeNull();
    });

    it('a branch that no longer exists leaves displayBranch null instead of failing', async () => {
      const m = build();
      m.branch.findMany.mockResolvedValueOnce([]);
      const [out] = await m.run([A], [row()]);
      expect(out!.displayBranch).toBeNull();
    });
  });
});
