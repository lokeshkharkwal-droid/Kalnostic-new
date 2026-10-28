import {
  findPanelMemberEntryFor,
  findSampleDefinitionAt,
  findSetupAtBranch,
  pickSetupRow,
  type SetupClient,
} from './performing-setup.util';

/**
 * Which test setup a branch uses while it holds a tube: its Lab Test List entry for the same tenant test
 * (default list first, a normal row before a "(Copy)"), and the Master Data copy that entry points at.
 */
const T0 = new Date('2026-01-01T00:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * 86_400_000);

interface Row {
  id: string;
  isDefault: boolean;
  isDuplicate: boolean;
  createdAt: Date;
  list: { isDefault: boolean } | null;
}
const row = (id: string, o: Partial<Row> = {}): Row => ({
  id,
  isDefault: true,
  isDuplicate: false,
  createdAt: at(0),
  list: { isDefault: true },
  ...o,
});

describe('pickSetupRow', () => {
  it('returns null when the branch has no entry', () => {
    expect(pickSetupRow([])).toBeNull();
  });

  it("prefers the branch's default list over another list", () => {
    const picked = pickSetupRow([
      row('corporate', { list: { isDefault: false }, createdAt: at(-5) }),
      row('walk-in'),
    ]);
    expect(picked?.id).toBe('walk-in');
  });

  it('prefers a normal row over a (Copy) row in the same list', () => {
    const picked = pickSetupRow([
      row('copy', { isDuplicate: true, isDefault: false, createdAt: at(-5) }),
      row('original'),
    ]);
    expect(picked?.id).toBe('original');
  });

  it('prefers the row marked default among normal rows, then the oldest', () => {
    expect(
      pickSetupRow([
        row('a', { isDefault: false, createdAt: at(-9) }),
        row('b', { isDefault: true, createdAt: at(-1) }),
      ])?.id,
    ).toBe('b');
    expect(
      pickSetupRow([
        row('new', { createdAt: at(3) }),
        row('old', { createdAt: at(1) }),
      ])?.id,
    ).toBe('old');
  });

  it('falls back to another list when the default list has no row, normal before copy', () => {
    const picked = pickSetupRow([
      row('other-copy', {
        list: { isDefault: false },
        isDuplicate: true,
        isDefault: false,
        createdAt: at(-9),
      }),
      row('other-normal', { list: { isDefault: false }, createdAt: at(2) }),
    ]);
    expect(picked?.id).toBe('other-normal');
  });

  it('is stable: the same entry whatever order the rows come in', () => {
    const a = row('a');
    const b = row('b');
    expect(pickSetupRow([a, b])?.id).toBe(pickSetupRow([b, a])?.id);
  });
});

interface World {
  /** every test id -> its tenant link (any branch, deleted or not) */
  tenantOf: Record<string, string | null>;
  /** active, not deleted Branch Master Data copies of the wanted branch */
  copies: Array<{ id: string; tenant: string }>;
  entries: Array<
    {
      id: string;
      sourceLabTestId: string | null;
      departmentId: string | null;
    } & Partial<Row>
  >;
}

function db(w: World) {
  return {
    labTest: {
      findFirst: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve(
          args.where.id in w.tenantOf
            ? { sourceMasterLabTestId: w.tenantOf[args.where.id] }
            : null,
        ),
      ),
      findMany: jest.fn((args: { where: { sourceMasterLabTestId: string } }) =>
        Promise.resolve(
          w.copies
            .filter((c) => c.tenant === args.where.sourceMasterLabTestId)
            .map((c) => ({ id: c.id })),
        ),
      ),
    },
    branchLabTest: {
      findMany: jest.fn(
        (args: { where: { sourceLabTestId: { in: string[] } } }) =>
          Promise.resolve(
            w.entries
              .filter(
                (e) =>
                  e.sourceLabTestId &&
                  args.where.sourceLabTestId.in.includes(e.sourceLabTestId),
              )
              .map((e) => ({
                isDefault: true,
                isDuplicate: false,
                createdAt: at(0),
                list: { isDefault: true },
                ...e,
              })),
          ),
      ),
    },
  } as unknown as SetupClient;
}

describe('findSetupAtBranch', () => {
  const world: World = {
    tenantOf: { 'a-urine': 'T-urine', 'a-hand': null },
    copies: [{ id: 'b-urine', tenant: 'T-urine' }],
    entries: [
      { id: 'b-entry', sourceLabTestId: 'b-urine', departmentId: 'dep-B' },
    ],
  };

  it("returns the branch's entry, the copy it points at and its department", async () => {
    await expect(
      findSetupAtBranch(db(world), 't', 'B', 'a-urine'),
    ).resolves.toEqual({
      branchLabTestId: 'b-entry',
      labTestId: 'b-urine',
      departmentId: 'dep-B',
    });
  });

  it('is null for a test with no tenant link (hand-created)', async () => {
    await expect(
      findSetupAtBranch(db(world), 't', 'B', 'a-hand'),
    ).resolves.toBeNull();
  });

  it('is null for an unknown test id', async () => {
    await expect(
      findSetupAtBranch(db(world), 't', 'B', 'nope'),
    ).resolves.toBeNull();
  });

  it('is null when the branch has no copy of the tenant test', async () => {
    await expect(
      findSetupAtBranch(db({ ...world, copies: [] }), 't', 'B', 'a-urine'),
    ).resolves.toBeNull();
  });

  it('is null when the branch has a copy but no active entry for it', async () => {
    await expect(
      findSetupAtBranch(db({ ...world, entries: [] }), 't', 'B', 'a-urine'),
    ).resolves.toBeNull();
  });

  it('a test the sender soft-deleted still resolves (only its tenant link is read)', async () => {
    const client = db({ ...world, tenantOf: { 'a-gone': 'T-urine' } });
    await expect(
      findSetupAtBranch(client, 't', 'B', 'a-gone'),
    ).resolves.toMatchObject({ labTestId: 'b-urine' });
  });

  it("uses the entry's own department, including none (unassigned)", async () => {
    const w: World = {
      ...world,
      entries: [
        { id: 'b-entry', sourceLabTestId: 'b-urine', departmentId: null },
      ],
    };
    const got = await findSetupAtBranch(db(w), 't', 'B', 'a-urine');
    expect(got?.departmentId).toBeNull();
  });

  it('with two entries for one copy, the default list wins and the copy follows the chosen entry', async () => {
    const w: World = {
      ...world,
      copies: [
        { id: 'b-urine', tenant: 'T-urine' },
        { id: 'b-urine-2', tenant: 'T-urine' },
      ],
      entries: [
        {
          id: 'corp',
          sourceLabTestId: 'b-urine-2',
          departmentId: 'dep-X',
          list: { isDefault: false },
          createdAt: at(-9),
        },
        { id: 'walk-in', sourceLabTestId: 'b-urine', departmentId: 'dep-B' },
      ],
    };
    await expect(
      findSetupAtBranch(db(w), 't', 'B', 'a-urine'),
    ).resolves.toEqual({
      branchLabTestId: 'walk-in',
      labTestId: 'b-urine',
      departmentId: 'dep-B',
    });
  });
});

describe('findSampleDefinitionAt', () => {
  const sample = (
    id: string,
    sampleType: string | null,
    containerType: string | null,
    sampleName: string | null,
    isDefault = false,
  ) => ({
    id,
    sampleType,
    containerType,
    sampleName,
    isDefault,
    createdAt: at(0),
  });

  const client = (wanted: unknown, candidates: unknown[]) =>
    ({
      labTestSample: {
        findFirst: jest.fn().mockResolvedValue(wanted),
        findMany: jest.fn().mockResolvedValue(candidates),
      },
    }) as unknown as SetupClient;

  const wanted = {
    sampleType: 'Urine',
    containerType: 'PLAIN',
    sampleName: 'Spot urine',
  };

  it('is null when the destination copy has no sample definition', async () => {
    await expect(
      findSampleDefinitionAt(client(wanted, []), 't', 's', 'dest'),
    ).resolves.toBeNull();
  });

  it('matches type + container + name first', async () => {
    const c = [
      sample('x', 'Urine', 'PLAIN', 'Other', true),
      sample('y', 'Urine', 'PLAIN', 'Spot urine'),
    ];
    await expect(
      findSampleDefinitionAt(client(wanted, c), 't', 's', 'd'),
    ).resolves.toBe('y');
  });

  it('then type + container, then type', async () => {
    await expect(
      findSampleDefinitionAt(
        client(wanted, [
          sample('p', 'Urine', 'EDTA', null, true),
          sample('q', 'Urine', 'PLAIN', null),
        ]),
        't',
        's',
        'd',
      ),
    ).resolves.toBe('q');
    await expect(
      findSampleDefinitionAt(
        client(wanted, [
          sample('p', 'Blood', 'EDTA', null, true),
          sample('q', 'Urine', 'EDTA', null),
        ]),
        't',
        's',
        'd',
      ),
    ).resolves.toBe('q');
  });

  it("falls back to the copy's first definition when nothing matches", async () => {
    await expect(
      findSampleDefinitionAt(
        client(wanted, [sample('p', 'Blood', 'EDTA', null, true)]),
        't',
        's',
        'd',
      ),
    ).resolves.toBe('p');
  });

  it("when the sender's definition cannot be read, takes the first one", async () => {
    await expect(
      findSampleDefinitionAt(
        client(null, [sample('p', 'Blood', 'EDTA', null, true)]),
        't',
        's',
        'd',
      ),
    ).resolves.toBe('p');
  });
});

describe('findPanelMemberEntryFor', () => {
  const client = (links: unknown[], members: unknown[]) =>
    ({
      branchLabPanelTest: { findMany: jest.fn().mockResolvedValue(links) },
      branchLabTest: { findMany: jest.fn().mockResolvedValue(members) },
    }) as unknown as SetupClient;

  it('is null for a panel with no members', async () => {
    await expect(
      findPanelMemberEntryFor(client([], []), 'panel', 'x'),
    ).resolves.toBeNull();
  });

  it("returns the panel's member entry for the test, with its branch", async () => {
    await expect(
      findPanelMemberEntryFor(
        client([{ branchLabTestId: 'm1' }], [{ id: 'm1', branchId: 'A' }]),
        'panel',
        'a-urine',
      ),
    ).resolves.toEqual({ id: 'm1', branchId: 'A' });
  });

  it('is null when no member serves that test', async () => {
    await expect(
      findPanelMemberEntryFor(
        client([{ branchLabTestId: 'm1' }], []),
        'panel',
        'zzz',
      ),
    ).resolves.toBeNull();
  });
});
