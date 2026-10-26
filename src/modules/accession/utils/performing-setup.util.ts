/**
 * Which test setup a branch uses for a test while it HOLDS the tube.
 *
 * Every branch has its own Master Data copy of a test (parameters, ranges, values, sample definitions)
 * and its own Lab Test List entries (template, TAT, department, price lists). A tube sent from A to B is
 * worked on with B's setup, so the report must point at B's copy while B holds it and at A's again once it
 * is back. The branches do not share rows; the match goes through the tenant test both copies came from:
 *   the report's test (`LabReport.labTestId` = some branch's Branch Master Data test, even a soft-deleted one)
 *     -> `LabTest.sourceMasterLabTestId` (the Tenant Master Data test)
 *     -> the branch's Lab Test List entry for that tenant test (see {@link pickSetupRow} for which one)
 *     -> the Branch Master Data copy that entry points at.
 * Picking the ENTRY first and taking the copy it points at keeps the technical details and the entry's
 * template / TAT / department coming from one place.
 *
 * Plain functions over a Prisma client (a transaction or the service client): no injection.
 */
import type { Prisma } from '@prisma/client';

/** The read access these lookups need. */
export type SetupClient = Pick<
  Prisma.TransactionClient,
  'labTest' | 'branchLabTest' | 'labTestSample' | 'branchLabPanelTest'
>;

/** What a branch uses to run one test. */
export interface PerformingSetup {
  /** The Lab Test List entry chosen (its template, TAT, department apply). */
  branchLabTestId: string;
  /** The Branch Master Data copy the entry points at (parameters, ranges, values, samples). */
  labTestId: string;
  /** The entry's department (null = unassigned, visible to everyone). */
  departmentId: string | null;
}

/** The fields {@link pickSetupRow} orders by. */
export interface SetupRowKey {
  id: string;
  isDefault: boolean;
  isDuplicate: boolean;
  createdAt: Date;
  list: { isDefault: boolean } | null;
}

/**
 * The preferred entry among a branch's entries for one tenant test: the branch's default list first, a
 * normal row before a "(Copy)", the row marked default before the others, then the oldest (id as the last,
 * stable tie-break so the same entry is chosen every time).
 */
export function pickSetupRow<T extends SetupRowKey>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  const rank = (r: T): [number, number, number] => [
    r.list?.isDefault ? 0 : 1,
    r.isDuplicate ? 1 : 0,
    r.isDefault ? 0 : 1,
  ];
  return [...rows].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) {
      if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    }
    const byTime = a.createdAt.getTime() - b.createdAt.getTime();
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  })[0]!;
}

/**
 * The setup `branchId` uses for the test `fromLabTestId` (a Branch Master Data test of ANY branch, deleted
 * or not - it only supplies the tenant link). Null when the test has no tenant link (hand-created) or the
 * branch has no active entry for it; callers then leave things as they are.
 * @param fromLabTestId the test the report / tube currently points at
 */
export async function findSetupAtBranch(
  db: SetupClient,
  tenantId: string,
  branchId: string,
  fromLabTestId: string,
): Promise<PerformingSetup | null> {
  const from = await db.labTest.findFirst({
    where: { id: fromLabTestId, tenantId },
    select: { sourceMasterLabTestId: true },
  });
  if (!from?.sourceMasterLabTestId) return null;

  const copies = await db.labTest.findMany({
    where: {
      tenantId,
      branchId,
      deletedAt: null,
      sourceMasterLabTestId: from.sourceMasterLabTestId,
    },
    select: { id: true },
  });
  if (copies.length === 0) return null;

  const rows = await db.branchLabTest.findMany({
    where: {
      tenantId,
      branchId,
      isActive: true,
      deletedAt: null,
      sourceLabTestId: { in: copies.map((c) => c.id) },
    },
    select: {
      id: true,
      sourceLabTestId: true,
      departmentId: true,
      isDefault: true,
      isDuplicate: true,
      createdAt: true,
      list: { select: { isDefault: true } },
    },
  });
  const row = pickSetupRow(rows);
  if (!row?.sourceLabTestId) return null;
  return {
    branchLabTestId: row.id,
    labTestId: row.sourceLabTestId,
    departmentId: row.departmentId,
  };
}

/**
 * The destination copy's own sample definition that matches the one a tube was created with (same sample
 * type + container + name where possible, then type + container, then type, then the copy's default or
 * first definition). Null when the destination copy has no sample definition (the caller keeps the old id).
 * @param fromLabTestSampleId the sender's `LabTestSample` the tube points at
 * @param destLabTestId the destination's Branch Master Data copy
 */
export async function findSampleDefinitionAt(
  db: SetupClient,
  tenantId: string,
  fromLabTestSampleId: string,
  destLabTestId: string,
): Promise<string | null> {
  const [wanted, candidates] = await Promise.all([
    db.labTestSample.findFirst({
      where: { id: fromLabTestSampleId },
      select: { sampleType: true, containerType: true, sampleName: true },
    }),
    db.labTestSample.findMany({
      where: { tenantId, labTestId: destLabTestId, deletedAt: null },
      select: {
        id: true,
        sampleType: true,
        containerType: true,
        sampleName: true,
        isDefault: true,
        createdAt: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  if (candidates.length === 0) return null;
  if (wanted) {
    const same = (
      a: {
        sampleType: string | null;
        containerType: string | null;
        sampleName: string | null;
      },
      fields: Array<'sampleType' | 'containerType' | 'sampleName'>,
    ) => fields.every((f) => (a[f] ?? null) === (wanted[f] ?? null));
    for (const fields of [
      ['sampleType', 'containerType', 'sampleName'],
      ['sampleType', 'containerType'],
      ['sampleType'],
    ] as Array<Array<'sampleType' | 'containerType' | 'sampleName'>>) {
      const hit = candidates.find((c) => same(c, fields));
      if (hit) return hit.id;
    }
  }
  return candidates[0]!.id;
}

/**
 * For a PANEL item: the panel's own member entry that serves `labTestId` (the report's
 * `memberBranchLabTestId` as it was created at the panel's branch). Null for a non-panel item or when the
 * panel has no member for that test (the caller then falls back to the branch's own entry).
 */
export async function findPanelMemberEntryFor(
  db: SetupClient,
  branchLabPanelId: string,
  labTestId: string,
): Promise<{ id: string; branchId: string | null } | null> {
  const links = await db.branchLabPanelTest.findMany({
    where: { branchLabPanelId, deletedAt: null },
    select: { branchLabTestId: true },
  });
  if (links.length === 0) return null;
  const members = await db.branchLabTest.findMany({
    where: {
      id: { in: links.map((l) => l.branchLabTestId) },
      sourceLabTestId: labTestId,
    },
    select: { id: true, branchId: true },
    orderBy: { id: 'asc' },
  });
  return members[0] ?? null;
}
