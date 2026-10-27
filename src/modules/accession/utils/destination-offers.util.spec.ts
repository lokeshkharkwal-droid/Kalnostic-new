import { SampleStatus } from '@prisma/client';
import {
  assertDestinationOffers,
  describeMissing,
  missingTestsAtBranches,
} from './destination-offers.util';
import {
  DestinationLacksTestException,
  InvalidSampleTransitionException,
} from '../exceptions/accession.exceptions';

/**
 * The destination must offer every test on the tube. The branches do not share rows, so the
 * match goes through the tenant test each Branch Master Data test came from.
 */
interface World {
  /** tube tests: sender Master Data test id -> name (null id = a free-text entry) */
  tubeTests: Array<{ labTestId: string | null; testName: string | null }>;
  /** sender Master Data test id -> its tenant test (missing/null = no link) */
  tenantOf: Record<string, string | null>;
  /** destination Master Data tests: id, branch, tenant test */
  destMaster: Array<{ id: string; branchId: string; tenant: string }>;
  /** destination Lab Test List entries (active ones; inactive/deleted never come back) */
  destList: Array<{ branchId: string; masterId: string }>;
}

function db(w: World) {
  return {
    orderSampleTest: {
      findMany: jest.fn().mockResolvedValue(w.tubeTests),
    },
    labTest: {
      findMany: jest.fn(
        (args: { where: { id?: unknown; branchId?: unknown } }) =>
          Promise.resolve(
            args.where.id
              ? Object.entries(w.tenantOf).map(([id, t]) => ({
                  id,
                  sourceMasterLabTestId: t,
                }))
              : w.destMaster.map((m) => ({
                  id: m.id,
                  branchId: m.branchId,
                  sourceMasterLabTestId: m.tenant,
                })),
          ),
      ),
    },
    branchLabTest: {
      findMany: jest.fn().mockResolvedValue(
        w.destList.map((e) => ({
          branchId: e.branchId,
          sourceLabTestId: e.masterId,
        })),
      ),
    },
    branch: {
      findFirst: jest.fn().mockResolvedValue({ name: 'Branch B' }),
    },
  };
}

const oneTest: World = {
  tubeTests: [{ labTestId: 'a-urine', testName: 'Urine' }],
  tenantOf: { 'a-urine': 'T-urine' },
  destMaster: [{ id: 'b-urine', branchId: 'B', tenant: 'T-urine' }],
  destList: [{ branchId: 'B', masterId: 'b-urine' }],
};

const run = (w: World, branches = ['B']) =>
  missingTestsAtBranches(db(w) as never, 't1', ['s1'], branches);

describe('missingTestsAtBranches', () => {
  it('a branch that lists the same tenant test offers it', async () => {
    expect((await run(oneTest)).get('B')).toEqual([]);
  });

  it('a branch with the master copy but NO active list entry does not offer it', async () => {
    const r = await run({ ...oneTest, destList: [] });
    expect(r.get('B')).toEqual([{ labTestId: 'a-urine', testName: 'Urine' }]);
  });

  it('a branch without any copy of the test does not offer it', async () => {
    const r = await run({ ...oneTest, destMaster: [], destList: [] });
    expect(r.get('B')?.map((m) => m.testName)).toEqual(['Urine']);
  });

  it('a list entry of ANOTHER branch does not count', async () => {
    const r = await run({
      ...oneTest,
      destList: [{ branchId: 'C', masterId: 'b-urine' }],
    });
    expect(r.get('B')).toHaveLength(1);
  });

  it('a tube test whose master copy has no tenant link can not be matched: not offered', async () => {
    const r = await run({ ...oneTest, tenantOf: { 'a-urine': null } });
    expect(r.get('B')?.map((m) => m.testName)).toEqual(['Urine']);
  });

  it('a tube test whose master copy no longer exists is not offered', async () => {
    const r = await run({ ...oneTest, tenantOf: {} });
    expect(r.get('B')).toHaveLength(1);
  });

  it('a free-text entry (no catalogue test) has nothing to check and is skipped', async () => {
    const r = await run({
      ...oneTest,
      tubeTests: [{ labTestId: null, testName: 'Handwritten' }],
    });
    expect(r.get('B')).toEqual([]);
  });

  it('a tube with several tests: only the missing ones are listed', async () => {
    const r = await run({
      tubeTests: [
        { labTestId: 'a-urine', testName: 'Urine' },
        { labTestId: 'a-hb', testName: 'Hemoglobin' },
        { labTestId: 'a-bun', testName: 'BUN' },
      ],
      tenantOf: { 'a-urine': 'T-u', 'a-hb': 'T-h', 'a-bun': 'T-b' },
      destMaster: [
        { id: 'b-u', branchId: 'B', tenant: 'T-u' },
        { id: 'b-h', branchId: 'B', tenant: 'T-h' },
      ],
      destList: [{ branchId: 'B', masterId: 'b-u' }],
    });
    expect(r.get('B')?.map((m) => m.testName)).toEqual(['Hemoglobin', 'BUN']);
  });

  it('a test that appears on two tubes is checked once', async () => {
    const r = await run({
      ...oneTest,
      tubeTests: [
        { labTestId: 'a-urine', testName: 'Urine' },
        { labTestId: 'a-urine', testName: 'Urine' },
      ],
      destList: [],
    });
    expect(r.get('B')).toHaveLength(1);
  });

  it('several branches are answered at once (the picker): each gets its own list', async () => {
    const w: World = {
      ...oneTest,
      destMaster: [
        { id: 'b-urine', branchId: 'B', tenant: 'T-urine' },
        { id: 'c-urine', branchId: 'C', tenant: 'T-urine' },
      ],
      destList: [{ branchId: 'B', masterId: 'b-urine' }],
    };
    const r = await run(w, ['B', 'C', 'D']);
    expect(r.get('B')).toEqual([]);
    expect(r.get('C')?.map((m) => m.testName)).toEqual(['Urine']); // master copy, not listed
    expect(r.get('D')?.map((m) => m.testName)).toEqual(['Urine']); // nothing at all
  });

  it('reads in sets, never per test or per branch', async () => {
    const d = db(oneTest);
    await missingTestsAtBranches(d as never, 't1', ['s1', 's2'], ['B', 'C']);
    expect(d.orderSampleTest.findMany).toHaveBeenCalledTimes(1);
    expect(d.labTest.findMany).toHaveBeenCalledTimes(2);
    expect(d.branchLabTest.findMany).toHaveBeenCalledTimes(1);
  });

  it('no tubes or no branches: nothing to check, nothing read', async () => {
    const d = db(oneTest);
    expect(
      (await missingTestsAtBranches(d as never, 't', [], ['B'])).get('B'),
    ).toEqual([]);
    expect(
      (await missingTestsAtBranches(d as never, 't', ['s'], [])).size,
    ).toBe(0);
    expect(d.orderSampleTest.findMany).not.toHaveBeenCalled();
  });
});

describe('assertDestinationOffers', () => {
  const call = (
    w: World,
    audience: 'sender' | 'receiver' = 'sender',
  ): Promise<void> =>
    assertDestinationOffers(
      db(w) as never,
      't1',
      ['s1'],
      'B',
      audience,
      SampleStatus.ACCEPTED,
    );

  it('passes silently when the destination offers everything', async () => {
    await expect(call(oneTest)).resolves.toBeUndefined();
  });

  it('the sender is told which branch lacks which tests and to choose another', async () => {
    const err = (await call({ ...oneTest, destList: [] }).catch(
      (e: unknown) => e,
    )) as DestinationLacksTestException;
    expect(err).toBeInstanceOf(DestinationLacksTestException);
    expect(err.getStatus()).toBe(422);
    const body = err.getResponse() as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('DESTINATION_LACKS_TEST');
    expect(body.error.message).toBe(
      'Branch B does not offer: Urine. Choose another branch.',
    );
  });

  it('the receiver is told its own branch cannot accept and what to do instead', async () => {
    const err = (await call({ ...oneTest, destList: [] }, 'receiver').catch(
      (e: unknown) => e,
    )) as DestinationLacksTestException;
    const body = err.getResponse() as { error: { message: string } };
    expect(body.error.message).toBe(
      'Your branch does not offer: Urine, so this transfer cannot be accepted. Reject it, or send it back with Repeat.',
    );
  });

  it('is skippable by group "skip invalid" actions (it is an invalid-transition refusal)', async () => {
    const err = await call({ ...oneTest, destList: [] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InvalidSampleTransitionException);
  });
});

describe('describeMissing', () => {
  const names = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      labTestId: `t${i}`,
      testName: `T${i}`,
    }));

  it('lists up to five names', () => {
    expect(describeMissing(names(2))).toBe('T0, T1');
    expect(describeMissing(names(5))).toBe('T0, T1, T2, T3, T4');
  });

  it('shortens a longer list to five names and a count', () => {
    expect(describeMissing(names(8))).toBe('T0, T1, T2, T3, T4 and 3 more');
  });
});
