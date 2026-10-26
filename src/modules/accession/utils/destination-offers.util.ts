/**
 * A tube may go to a branch only if that branch OFFERS every test on it.
 *
 * "Offers" = the branch has an ACTIVE Lab Test List entry (`BranchLabTest`) for the test.
 * The branches do not share rows - each has its own Master Data copy of a test - so the
 * match goes through the tenant test both copies came from:
 *   tube test (`OrderSampleTest.labTestId` = the sender's Branch Master Data test)
 *     -> `LabTest.sourceMasterLabTestId` (the Tenant Master Data test)
 *     -> the destination's Branch Master Data test with the same tenant test
 *     -> an active, not deleted Lab Test List entry of the destination for that test.
 * A test with no tenant link (hand-created at the branch) can not be matched, so it counts
 * as NOT offered. A tube test with no catalogue test at all (`labTestId` null: a free-text
 * entry) has nothing to check and is skipped.
 *
 * Plain functions over a Prisma client (a transaction or the service client): no injection,
 * so every caller and every spec keeps its current constructor.
 */
import type { Prisma, SampleStatus } from '@prisma/client';
import { DestinationLacksTestException } from '../exceptions/accession.exceptions';

/** The read access this check needs (a transaction client or the service client satisfies it). */
export type OfferClient = Pick<
  Prisma.TransactionClient,
  'orderSampleTest' | 'labTest' | 'branchLabTest'
>;

/** A tube test the destination does not offer. */
export interface MissingTest {
  labTestId: string;
  testName: string;
}

/** How many test names a message lists before "and N more". */
const MESSAGE_NAME_LIMIT = 5;

/**
 * For each of `branchIds`, the tests on `sampleIds` that branch does not offer (an empty
 * list = it offers all of them). One set-based read of the tube's tests, one of the
 * sender's test identities, and one pair of reads covering ALL the branches.
 * @param branchIds the destination branches to check
 */
export async function missingTestsAtBranches(
  db: OfferClient,
  tenantId: string,
  sampleIds: string[],
  branchIds: string[],
): Promise<Map<string, MissingTest[]>> {
  const result = new Map<string, MissingTest[]>(
    branchIds.map((id) => [id, []]),
  );
  if (sampleIds.length === 0 || branchIds.length === 0) return result;

  // 1. the catalogue tests on the tubes (a test on several tubes counts once)
  const links = await db.orderSampleTest.findMany({
    where: {
      tenantId,
      sampleId: { in: sampleIds },
      deletedAt: null,
      labTestId: { not: null },
    },
    select: { labTestId: true, testName: true },
  });
  const nameOf = new Map<string, string>();
  for (const l of links) {
    if (l.labTestId && !nameOf.has(l.labTestId)) {
      nameOf.set(l.labTestId, l.testName ?? l.labTestId);
    }
  }
  if (nameOf.size === 0) return result;

  // 2. each test's tenant identity (null = no tenant link: it can not be matched)
  const senderTests = await db.labTest.findMany({
    where: { tenantId, id: { in: [...nameOf.keys()] } },
    select: { id: true, sourceMasterLabTestId: true },
  });
  const tenantOf = new Map<string, string | null>(
    senderTests.map((t) => [t.id, t.sourceMasterLabTestId]),
  );
  const tenantIds = [
    ...new Set([...tenantOf.values()].filter((v): v is string => !!v)),
  ];

  // 3. what each destination offers among those tenant tests
  const offered = new Set<string>(); // `${branchId}|${tenantTestId}`
  if (tenantIds.length > 0) {
    const destTests = await db.labTest.findMany({
      where: {
        tenantId,
        branchId: { in: branchIds },
        deletedAt: null,
        sourceMasterLabTestId: { in: tenantIds },
      },
      select: { id: true, branchId: true, sourceMasterLabTestId: true },
    });
    const byDestTest = new Map(destTests.map((t) => [t.id, t]));
    if (destTests.length > 0) {
      const entries = await db.branchLabTest.findMany({
        where: {
          tenantId,
          branchId: { in: branchIds },
          isActive: true,
          deletedAt: null,
          sourceLabTestId: { in: destTests.map((t) => t.id) },
        },
        select: { branchId: true, sourceLabTestId: true },
      });
      for (const e of entries) {
        const t = e.sourceLabTestId ? byDestTest.get(e.sourceLabTestId) : null;
        if (t?.sourceMasterLabTestId) {
          offered.add(`${e.branchId}|${t.sourceMasterLabTestId}`);
        }
      }
    }
  }

  for (const branchId of branchIds) {
    const missing: MissingTest[] = [];
    for (const [labTestId, testName] of nameOf) {
      const tenant = tenantOf.get(labTestId) ?? null;
      if (!tenant || !offered.has(`${branchId}|${tenant}`)) {
        missing.push({ labTestId, testName });
      }
    }
    result.set(branchId, missing);
  }
  return result;
}

/** "A, B, C and 2 more" - the test names a refusal lists. */
export function describeMissing(missing: MissingTest[]): string {
  const names = missing.map((m) => m.testName);
  if (names.length <= MESSAGE_NAME_LIMIT) return names.join(', ');
  return `${names.slice(0, MESSAGE_NAME_LIMIT).join(', ')} and ${
    names.length - MESSAGE_NAME_LIMIT
  } more`;
}

/**
 * Refuses (`DestinationLacksTestException`) when `destinationBranchId` does not offer every
 * test on `sampleIds`.
 * @param audience 'sender' = the sending branch is choosing the destination (Send, Assign /
 *   Edit Center); 'receiver' = the receiving branch is accepting a tube already on its way
 * @param from the tube's status, only for the exception
 */
export async function assertDestinationOffers(
  db: OfferClient & Pick<Prisma.TransactionClient, 'branch'>,
  tenantId: string,
  sampleIds: string[],
  destinationBranchId: string,
  audience: 'sender' | 'receiver',
  from: SampleStatus,
): Promise<void> {
  const missing = (
    await missingTestsAtBranches(db, tenantId, sampleIds, [destinationBranchId])
  ).get(destinationBranchId);
  if (!missing || missing.length === 0) return;
  const tests = describeMissing(missing);
  if (audience === 'receiver') {
    throw new DestinationLacksTestException(
      from,
      `Your branch does not offer: ${tests}, so this transfer cannot be accepted. Reject it, or send it back with Repeat.`,
    );
  }
  const branch = await db.branch.findFirst({
    where: { id: destinationBranchId, tenantId },
    select: { name: true },
  });
  throw new DestinationLacksTestException(
    from,
    `${branch?.name ?? 'That branch'} does not offer: ${tests}. Choose another branch.`,
  );
}
