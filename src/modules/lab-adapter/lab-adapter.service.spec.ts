import { LabAdapterService } from './lab-adapter.service';
import {
  LabAdapterBranchNotFoundException,
  LabAdapterLabTestBranchMismatchException,
  LabAdapterLabTestNotFoundException,
} from './exceptions/lab-adapter.exceptions';
import type { LabAdapterWithRelations } from './entities/lab-adapter.entity';
import type { PrismaService } from '../../prisma/prisma.service';
import type { BranchService } from '../branch/branch.service';
import type { EquipmentService } from '../equipment/equipment.service';

/**
 * Each branch keeps its own copy of a test. The adapter form's Lab Tests picker lists every TEST once
 * (copies grouped by Test Name + Test Code) and picking it links all of its copies at the adapter's branches.
 * Prisma and BranchService are stubbed; the assertions check the queries the service builds, the options it
 * returns and the rows it writes (one row per branch copy — what the LIS reads).
 */
const TENANT = 't1';

interface Row {
  id: string;
  branchId: string;
  testName: string;
  testCode: string | null;
}
// CBC exists at both branches, LFT only at b1, Urine only at b2.
const CBC_1: Row = {
  id: 'cbc-1',
  branchId: 'b1',
  testName: 'CBC',
  testCode: 'C01',
};
const CBC_2: Row = {
  id: 'cbc-2',
  branchId: 'b2',
  testName: 'CBC',
  testCode: 'C01',
};
const LFT_1: Row = {
  id: 'lft-1',
  branchId: 'b1',
  testName: 'LFT',
  testCode: 'L01',
};
const URINE_2: Row = {
  id: 'urine-2',
  branchId: 'b2',
  testName: 'Urine',
  testCode: null,
};
const ALL_ROWS = [CBC_1, CBC_2, LFT_1, URINE_2];

const BRANCH_NAMES: Record<string, string> = {
  b1: 'Main Lab',
  b2: 'City Centre',
};

/** Stubs a prisma whose `branchLabTest.findMany` answers both query shapes the service makes. */
function makePrisma(rows: Row[] = ALL_ROWS) {
  const listFindMany = jest.fn().mockResolvedValue([{ id: 'list-a' }]);
  const testFindMany = jest.fn(
    ({
      where,
    }: {
      where: {
        id?: { in: string[] };
        branchId?: { in: string[] };
        testName?: { contains: string };
      };
    }) => {
      let out = rows;
      if (where.id) out = out.filter((r) => where.id!.in.includes(r.id));
      if (where.branchId)
        out = out.filter((r) => where.branchId!.in.includes(r.branchId));
      if (where.testName)
        out = out.filter((r) =>
          r.testName
            .toLowerCase()
            .includes(where.testName!.contains.toLowerCase()),
        );
      return Promise.resolve(out);
    },
  );
  return { listFindMany, testFindMany };
}

function makeBranchService(branches: Record<string, string>) {
  return {
    findById: jest.fn((id: string) =>
      id in branches
        ? Promise.resolve({ id, name: branches[id] })
        : Promise.reject(new Error('not found')),
    ),
  } as unknown as BranchService;
}

describe('LabAdapterService.findLabTestOptions', () => {
  function makeService(
    branches: Record<string, string> = BRANCH_NAMES,
    rows: Row[] = ALL_ROWS,
  ) {
    const { listFindMany, testFindMany } = makePrisma(rows);
    const prisma = {
      branchLabTestList: { findMany: listFindMany },
      branchLabTest: { findMany: testFindMany },
    } as unknown as PrismaService;
    const service = new LabAdapterService(
      prisma,
      makeBranchService(branches),
      {} as EquipmentService,
    );
    return { service, listFindMany, testFindMany };
  }

  it('scopes to the selected branches (no active branch) and the default lists', async () => {
    const { service, listFindMany, testFindMany } = makeService();

    await service.findLabTestOptions(TENANT, {
      branchIds: ['b1', 'b2'],
      search: 'cb',
    });

    const [listArgs] = listFindMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(listArgs.where).toMatchObject({
      tenantId: TENANT,
      branchId: { in: ['b1', 'b2'] },
      isDefault: true,
    });
    const [testArgs] = testFindMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(testArgs.where).toMatchObject({
      tenantId: TENANT,
      branchId: { in: ['b1', 'b2'] },
      listId: { in: ['list-a'] },
      isActive: true,
      isDefault: true,
      testName: { contains: 'cb', mode: 'insensitive' },
    });
  });

  it('lists a test once even though two branches each have a copy', async () => {
    const { service } = makeService();

    const res = await service.findLabTestOptions(TENANT, {
      branchIds: ['b1', 'b2'],
    });

    expect(res).toEqual([
      {
        id: 'cbc-1',
        name: 'CBC (C01)',
        branchId: 'b1',
        branchIds: ['b1', 'b2'],
        hint: 'All selected branches',
      },
      {
        id: 'lft-1',
        name: 'LFT (L01)',
        branchId: 'b1',
        branchIds: ['b1'],
        hint: 'Main Lab',
      },
      {
        id: 'urine-2',
        name: 'Urine',
        branchId: 'b2',
        branchIds: ['b2'],
        hint: 'City Centre',
      },
    ]);
  });

  it('uses the copy at the first selected branch as the option id', async () => {
    const { service } = makeService();

    const res = (await service.findLabTestOptions(TENANT, {
      branchIds: ['b2', 'b1'],
    })) as { id: string; name: string }[];

    expect(res.find((o) => o.name === 'CBC (C01)')!.id).toBe('cbc-2');
  });

  it('groups copies whose name/code differ only in case or spacing', async () => {
    const { service } = makeService(BRANCH_NAMES, [
      { id: 'a', branchId: 'b1', testName: 'Hemoglobin', testCode: 'HB' },
      { id: 'b', branchId: 'b2', testName: ' hemoglobin ', testCode: 'hb' },
    ]);

    const res = (await service.findLabTestOptions(TENANT, {
      branchIds: ['b1', 'b2'],
    })) as unknown[];

    expect(res).toHaveLength(1);
  });

  it('keeps tests with the same name but a different code apart', async () => {
    const { service } = makeService(BRANCH_NAMES, [
      { id: 'a', branchId: 'b1', testName: 'Glucose', testCode: 'G1' },
      { id: 'b', branchId: 'b2', testName: 'Glucose', testCode: 'G2' },
    ]);

    const res = (await service.findLabTestOptions(TENANT, {
      branchIds: ['b1', 'b2'],
    })) as unknown[];

    expect(res).toHaveLength(2);
  });

  it('gives no hint when a single branch is selected', async () => {
    const { service } = makeService();

    const res = (await service.findLabTestOptions(TENANT, {
      branchIds: ['b1'],
    })) as { hint?: string }[];

    expect(res.map((o) => o.hint)).toEqual([undefined, undefined]);
  });

  it('paginates the grouped list and counts tests, not branch copies', async () => {
    const { service } = makeService();

    const res = await service.findLabTestOptions(TENANT, {
      branchIds: ['b1', 'b2'],
      page: 2,
      limit: 2,
    });

    expect(res).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect((res as { data: { id: string }[] }).data.map((o) => o.id)).toEqual([
      'urine-2',
    ]);
  });

  it('rejects a branch outside the tenant', async () => {
    const { service, testFindMany } = makeService({ b1: 'Main Lab' });

    await expect(
      service.findLabTestOptions(TENANT, { branchIds: ['b1', 'other'] }),
    ).rejects.toBeInstanceOf(LabAdapterBranchNotFoundException);
    expect(testFindMany).not.toHaveBeenCalled();
  });
});

/**
 * Saving: a pick links every copy of that test at the adapter's branches, never a copy at a branch the adapter is
 * not assigned to; an update that only changes branches drops the removed branch's tests and adds none.
 * `withTenant(id, cb)` runs `cb(tx)` so the written rows can be inspected.
 */
describe('LabAdapterService — saving picked lab tests', () => {
  function makeWriteService() {
    const tx = {
      labAdapter: {
        create: jest.fn().mockResolvedValue({ id: 'a1' }),
        update: jest.fn(),
      },
      labAdapterBranch: { updateMany: jest.fn(), createMany: jest.fn() },
      labAdapterTest: { updateMany: jest.fn(), createMany: jest.fn() },
    };
    const { listFindMany, testFindMany } = makePrisma();
    const withTenant = jest.fn(
      (_t: string, cb: (x: typeof tx) => Promise<unknown>) => cb(tx),
    );
    const prisma = {
      labAdapter: {
        findFirst: jest.fn().mockResolvedValue({ id: 'a1', equipmentId: 'e1' }),
      },
      labAdapterTest: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { branchLabTestId: 'cbc-1' },
            { branchLabTestId: 'cbc-2' },
          ]),
      },
      branchLabTestList: { findMany: listFindMany },
      branchLabTest: { findMany: testFindMany },
      withTenant,
    } as unknown as PrismaService;
    const equipmentService = {
      findById: jest.fn().mockResolvedValue({ id: 'e1', labTests: [] }),
    } as unknown as EquipmentService;
    const service = new LabAdapterService(
      prisma,
      makeBranchService({ b1: 'b1', b2: 'b2', b3: 'b3' }),
      equipmentService,
    );
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue({} as LabAdapterWithRelations);
    return { service, tx, withTenant };
  }

  const savedIds = (
    tx: ReturnType<typeof makeWriteService>['tx'],
  ): string[] => {
    const calls = tx.labAdapterTest.createMany.mock.calls as [
      { data: { branchLabTestId: string }[] },
    ][];
    return calls[0]![0].data.map((r) => r.branchLabTestId);
  };

  it('create: one pick links the copy at every adapter branch that has the test', async () => {
    const { service, tx } = makeWriteService();

    await service.create(TENANT, null, {
      name: 'Bridge',
      equipmentId: 'e1',
      branchIds: ['b1', 'b2'],
      labTestIds: ['cbc-1'],
    });

    expect(savedIds(tx)).toEqual(['cbc-1', 'cbc-2']);
  });

  it('create: a test that exists at only one adapter branch links only that copy', async () => {
    const { service, tx } = makeWriteService();

    await service.create(TENANT, null, {
      name: 'Bridge',
      equipmentId: 'e1',
      branchIds: ['b1', 'b2'],
      labTestIds: ['lft-1'],
    });

    expect(savedIds(tx)).toEqual(['lft-1']);
  });

  it('create: picking both copies of a test does not save it twice', async () => {
    const { service, tx } = makeWriteService();

    await service.create(TENANT, null, {
      name: 'Bridge',
      equipmentId: 'e1',
      branchIds: ['b1', 'b2'],
      labTestIds: ['cbc-1', 'cbc-2', 'lft-1'],
    });

    expect(savedIds(tx)).toEqual(['cbc-1', 'cbc-2', 'lft-1']);
  });

  it('create: never links a copy at a branch the adapter is not assigned to', async () => {
    const { service, tx } = makeWriteService();

    await service.create(TENANT, null, {
      name: 'Bridge',
      equipmentId: 'e1',
      branchIds: ['b1'],
      labTestIds: ['cbc-1'],
    });

    expect(savedIds(tx)).toEqual(['cbc-1']);
  });

  it('create rejects a test with no copy at any of the adapter branches', async () => {
    const { service, withTenant } = makeWriteService();

    await expect(
      service.create(TENANT, null, {
        name: 'Bridge',
        equipmentId: 'e1',
        branchIds: ['b1'],
        labTestIds: ['urine-2'],
      }),
    ).rejects.toBeInstanceOf(LabAdapterLabTestBranchMismatchException);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('create rejects an unknown test id', async () => {
    const { service, withTenant } = makeWriteService();

    await expect(
      service.create(TENANT, null, {
        name: 'Bridge',
        equipmentId: 'e1',
        branchIds: ['b1'],
        labTestIds: ['nope'],
      }),
    ).rejects.toBeInstanceOf(LabAdapterLabTestNotFoundException);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('update: a pick whose copy is at a removed branch is replaced by the copy at the branch that stays', async () => {
    const { service, tx } = makeWriteService();

    await service.update('a1', TENANT, null, {
      branchIds: ['b1'],
      labTestIds: ['cbc-2'],
    });

    expect(savedIds(tx)).toEqual(['cbc-1']);
  });

  it('update: rejects a pick that exists only at a removed branch', async () => {
    const { service, withTenant } = makeWriteService();

    await expect(
      service.update('a1', TENANT, null, {
        branchIds: ['b1'],
        labTestIds: ['urine-2'],
      }),
    ).rejects.toBeInstanceOf(LabAdapterLabTestBranchMismatchException);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it("update with only branchIds drops the removed branch's tests and adds none", async () => {
    const { service, tx } = makeWriteService();

    await service.update('a1', TENANT, null, { branchIds: ['b1'] });

    expect(savedIds(tx)).toEqual(['cbc-1']);
  });

  it('update without branchIds or labTestIds leaves the saved tests alone', async () => {
    const { service, tx } = makeWriteService();

    await service.update('a1', TENANT, null, { name: 'Renamed' });

    expect(tx.labAdapterTest.updateMany).not.toHaveBeenCalled();
    expect(tx.labAdapterTest.createMany).not.toHaveBeenCalled();
  });
});
