import type { WorklistBranchScope } from './access/worklist-branch-scope';
import { LabReportService } from './lab-report.service';

/**
 * `attachAccessMode` marks each worklist row `full` (the caller can work on it at the
 * branch holding it) or `view` (look and print only).
 *
 * The case under test: a report SENT by branch A and ACCEPTED by branch B sits at B
 * but is listed under A (the sender link).
 *  - A user whose OWN branch is the receiver B can work on it even with A selected.
 *  - A user whose own branch is the SENDER A keeps the look-only view in A's view
 *    (they work on it by selecting B or All Branches).
 *  - A report the holder has passed on (its sample is sent out) is look-only for
 *    everyone.
 * Mocked database; the pure rule is covered by `access/worklist-branch-scope.spec.ts`.
 */
describe('LabReportService.attachAccessMode', () => {
  const TENANT = 't1';
  const A = 'branch-A';
  const B = 'branch-B';
  const S = 'branch-S';

  type Row = { id: string; branchId: string | null };

  /**
   * @param sentOutAt report ids whose sample the holder branch has sent on, keyed
   *   by that branch (what `findSentOutReportIds` finds)
   */
  const build = (sentOutAt: Record<string, string[]> = {}) => {
    const orderSampleTest = {
      findMany: jest.fn(
        ({ where }: { where: { sample: { is: { branchId: string } } } }) => {
          const ids = sentOutAt[where.sample.is.branchId] ?? [];
          return Promise.resolve(
            ids.map((id) => ({ orderItemId: `item-${id}`, labTestId: null })),
          );
        },
      ),
    };
    const labReport = {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { branchId: string; orderItemId: { in: string[] } };
        }) =>
          Promise.resolve(
            where.orderItemId.in
              .map((item) => item.replace('item-', ''))
              .filter((id) => (sentOutAt[where.branchId] ?? []).includes(id))
              .map((id) => ({
                id,
                orderItemId: `item-${id}`,
                memberBranchLabTestId: null,
                labTestId: null,
              })),
          ),
      ),
    };
    const deps = Array(11).fill(undefined) as unknown[];
    deps[0] = { orderSampleTest, labReport };
    const service = new LabReportService(
      ...(deps as ConstructorParameters<typeof LabReportService>),
    );
    const run = async (
      scope: WorklistBranchScope,
      rows: Row[],
    ): Promise<Record<string, 'full' | 'view'>> => {
      const out = await (
        service as unknown as {
          attachAccessMode: (
            tenantId: string,
            scope: WorklistBranchScope,
            rows: Row[],
          ) => Promise<Array<Row & { accessMode: 'full' | 'view' }>>;
        }
      ).attachAccessMode(TENANT, scope, rows);
      return Object.fromEntries(out.map((r) => [r.id, r.accessMode]));
    };
    return { run, orderSampleTest, labReport };
  };

  // The selected branch is A, which has sent samples that B accepted.
  // `ownBranchId` is the caller's home branch (set only for such a sender view).
  const selectedA = (ownBranchId?: string) => ({
    rules: [{ branchId: A, statuses: 'ALL' as const, senderLinked: true }],
    ...(ownBranchId ? { ownBranchId } : {}),
  });

  it('a report held by the selected branch is full', async () => {
    const { run } = build();
    expect(await run(selectedA(A), [{ id: 'own', branchId: A }])).toEqual({
      own: 'full',
    });
  });

  it('a user of the RECEIVER B who selects the sender A can work on the report at B', async () => {
    const { run } = build();
    expect(await run(selectedA(B), [{ id: 'atB', branchId: B }])).toEqual({
      atB: 'full',
    });
  });

  it('a user of the SENDER A, viewing A, keeps the look-only view of the report at B', async () => {
    const { run } = build();
    expect(await run(selectedA(A), [{ id: 'atB', branchId: B }])).toEqual({
      atB: 'view',
    });
  });

  it("a branch that is neither selected nor the caller's own stays view", async () => {
    const { run } = build();
    expect(await run(selectedA(B), [{ id: 'atS', branchId: S }])).toEqual({
      atS: 'view',
    });
  });

  it('stays view when the scope has no own branch (a branch that sent nothing)', async () => {
    const { run } = build();
    expect(await run(selectedA(), [{ id: 'atB', branchId: B }])).toEqual({
      atB: 'view',
    });
  });

  it("a report the holder has sent on is view even for the holder's own user", async () => {
    const { run } = build({ [B]: ['sentOn'] });
    const modes = await run(selectedA(B), [
      { id: 'sentOn', branchId: B },
      { id: 'normal', branchId: B },
    ]);
    expect(modes).toEqual({ sentOn: 'view', normal: 'full' });
  });

  it("a selected branch's own sent-out report is still view (unchanged)", async () => {
    const { run } = build({ [A]: ['inTransit'] });
    expect(await run(selectedA(A), [{ id: 'inTransit', branchId: A }])).toEqual(
      { inTransit: 'view' },
    );
  });

  it('a report with no holder branch is view', async () => {
    const { run } = build();
    expect(await run(selectedA(B), [{ id: 'orphan', branchId: null }])).toEqual(
      { orphan: 'view' },
    );
  });

  it('looks up sent-out reports only at branches the caller can work at', async () => {
    const { run, orderSampleTest } = build();
    await run(selectedA(B), [
      { id: 'own', branchId: A },
      { id: 'atB', branchId: B },
      { id: 'atS', branchId: S },
    ]);
    const asked = (
      orderSampleTest.findMany.mock.calls as Array<
        [{ where: { sample: { is: { branchId: string } } } }]
      >
    )
      .map((c) => c[0].where.sample.is.branchId)
      .sort();
    expect(asked).toEqual([A, B]);
  });

  it('a mixed list is marked row by row', async () => {
    const { run } = build();
    const modes = await run(selectedA(B), [
      { id: 'own', branchId: A },
      { id: 'atB', branchId: B },
      { id: 'atS', branchId: S },
    ]);
    expect(modes).toEqual({ own: 'full', atB: 'full', atS: 'view' });
  });
});
