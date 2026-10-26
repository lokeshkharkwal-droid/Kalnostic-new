import { Prisma } from '@prisma/client';
import { BranchLabTestListService } from './branch-lab-test-list.service';
import { BranchLabPanelListService } from '../branch-lab-panel-list/branch-lab-panel-list.service';

/**
 * A branch has no Walk-in (default) list until something creates it. The lists page reads
 * `findAll` for its tabs and needs a default list to target Import / Sync, so `findAll`
 * ensures it exists. Same for lab tests and lab panels.
 */
const TENANT = 't1';
const BRANCH = 'b1';
const ACTOR = 'p1';

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

type Case = {
  label: string;
  model: 'branchLabTestList' | 'branchLabPanelList';
  build: (prisma: never) => {
    findAll: (t: string, b: string, a?: string | null) => Promise<unknown[]>;
    getOrCreateDefaultList: (
      t: string,
      b: string,
      a: string | null,
    ) => Promise<unknown>;
  };
};

const CASES: Case[] = [
  {
    label: 'lab test lists',
    model: 'branchLabTestList',
    build: (p) => new BranchLabTestListService(p),
  },
  {
    label: 'lab panel lists',
    model: 'branchLabPanelList',
    build: (p) => new BranchLabPanelListService(p),
  },
];

describe.each(CASES)('default (Walk-in) $label', ({ model, build }) => {
  /** `rows` = what is already stored; `create` can be overridden to simulate a race. */
  function setup(rows: Record<string, unknown>[], create?: jest.Mock) {
    const store = [...rows];
    const delegate = {
      findFirst: jest.fn(({ where }: { where: { isDefault?: boolean } }) =>
        Promise.resolve(
          store.find((r) => !where.isDefault || r.isDefault) ?? null,
        ),
      ),
      findMany: jest.fn(() => Promise.resolve([...store])),
      create:
        create ??
        jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const row = { id: 'walk-in', ...data };
          store.push(row);
          return Promise.resolve(row);
        }),
    };
    const prisma = { [model]: delegate };
    return { service: build(prisma as never), delegate, store };
  }

  it('creates the Walk-in list when the branch has none, then returns it', async () => {
    const { service, delegate } = setup([]);

    const result = (await service.findAll(TENANT, BRANCH, ACTOR)) as {
      name: string;
      isDefault: boolean;
    }[];

    expect(delegate.create).toHaveBeenCalledTimes(1);
    expect(createdData(delegate.create)).toMatchObject({
      tenantId: TENANT,
      branchId: BRANCH,
      name: 'Walk-in',
      isDefault: true,
      createdBy: ACTOR,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Walk-in', isDefault: true });
  });

  it('does not create a second one when a default list already exists', async () => {
    const { service, delegate } = setup([
      { id: 'd', name: 'Walk-in', isDefault: true },
      { id: 'x', name: 'B2B', isDefault: false },
    ]);

    const result = await service.findAll(TENANT, BRANCH, ACTOR);

    expect(delegate.create).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
  });

  it('records no creator when the caller does not pass one', async () => {
    const { service, delegate } = setup([]);

    await service.findAll(TENANT, BRANCH);

    expect(createdData(delegate.create)).toMatchObject({
      createdBy: null,
      updatedBy: null,
    });
  });

  it('survives a race: when another request creates it first, it returns that one', async () => {
    const winner = { id: 'winner', name: 'Walk-in', isDefault: true };
    const create = jest.fn().mockRejectedValue(uniqueViolation());
    const { service, delegate } = setup([], create);
    // The first lookup finds nothing; after the failed insert the winner is there.
    delegate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);

    await expect(
      service.getOrCreateDefaultList(TENANT, BRANCH, ACTOR),
    ).resolves.toBe(winner);
  });

  it('does not hide other database errors', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const { service } = setup([], create);

    await expect(service.findAll(TENANT, BRANCH, ACTOR)).rejects.toThrow(
      'db down',
    );
  });
});

/** The `data` passed to the first `create` call. */
function createdData(create: jest.Mock): Record<string, unknown> {
  const calls = create.mock.calls as [{ data: Record<string, unknown> }][];
  const first = calls[0];
  if (!first) throw new Error('create was not called');
  return first[0].data;
}
