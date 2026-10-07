import { LabAdapterService } from './lab-adapter.service';
import {
  LabAdapterBranchNotFoundException,
  LabAdapterLabTestBranchMismatchException,
} from './exceptions/lab-adapter.exceptions';
import type { LabAdapterWithRelations } from './entities/lab-adapter.entity';
import type { PrismaService } from '../../prisma/prisma.service';
import type { BranchService } from '../branch/branch.service';
import type { EquipmentService } from '../equipment/equipment.service';

/**
 * Unit tests for `findLabTestOptions` — the adapter form's manual Lab Tests
 * picker. It must work without a JWT active branch (Business Admin), scoping by
 * the client-supplied `branchIds` after verifying each against the tenant.
 *
 * Prisma and BranchService are stubbed; the assertions check the where clause
 * the service builds and the option labels it returns.
 */
const TENANT = 't1';

function makeService(branches: Record<string, string>) {
  const listFindMany = jest.fn().mockResolvedValue([{ id: 'list-a' }]);
  const testFindMany = jest.fn().mockResolvedValue([
    { id: 'blt-1', branchId: 'b1', testName: 'CBC', testCode: 'C01' },
    { id: 'blt-2', branchId: 'b2', testName: 'CBC', testCode: 'C01' },
  ]);
  const testCount = jest.fn().mockResolvedValue(2);
  const prisma = {
    branchLabTestList: { findMany: listFindMany },
    branchLabTest: { findMany: testFindMany, count: testCount },
  } as unknown as PrismaService;
  const branchService = {
    findById: jest.fn((id: string) =>
      id in branches
        ? Promise.resolve({ id, name: branches[id] })
        : Promise.reject(new Error('not found')),
    ),
  } as unknown as BranchService;
  const service = new LabAdapterService(
    prisma,
    branchService,
    {} as EquipmentService,
  );
  return { service, listFindMany, testFindMany };
}

describe('LabAdapterService.findLabTestOptions', () => {
  it('scopes to the selected branches (no active branch) and labels by branch', async () => {
    const { service, listFindMany, testFindMany } = makeService({
      b1: 'Main Lab',
      b2: 'City Centre',
    });

    const res = await service.findLabTestOptions(TENANT, {
      branchIds: ['b1', 'b2'],
      search: 'cb',
      page: 1,
      limit: 10,
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
      { where: Record<string, unknown>; skip: number; take: number },
    ];
    expect(testArgs.where).toMatchObject({
      tenantId: TENANT,
      branchId: { in: ['b1', 'b2'] },
      listId: { in: ['list-a'] },
      testName: { contains: 'cb', mode: 'insensitive' },
    });
    expect(testArgs.skip).toBe(0);
    expect(testArgs.take).toBe(10);
    expect(res).toEqual({
      data: [
        { id: 'blt-1', name: 'CBC (C01) · Main Lab', branchId: 'b1' },
        { id: 'blt-2', name: 'CBC (C01) · City Centre', branchId: 'b2' },
      ],
      total: 2,
      page: 1,
      limit: 10,
    });
  });

  it('omits the branch suffix when a single branch is selected', async () => {
    const { service } = makeService({ b1: 'Main Lab' });

    const res = await service.findLabTestOptions(TENANT, { branchIds: ['b1'] });

    expect(res).toEqual([
      { id: 'blt-1', name: 'CBC (C01)', branchId: 'b1' },
      { id: 'blt-2', name: 'CBC (C01)', branchId: 'b2' },
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
 * A lab test picked for a branch that is then removed must never be saved:
 * create/update reject it, and an update that only changes branches drops the
 * removed branch's tests. Prisma is stubbed; `withTenant(id, cb)` runs `cb(tx)`.
 */
describe('LabAdapterService — lab tests follow the selected branches', () => {
  // blt-1 lives at b1, blt-2 at b2.
  const TEST_BRANCH: Record<string, string> = { 'blt-1': 'b1', 'blt-2': 'b2' };

  function makeWriteService() {
    const tx = {
      labAdapter: {
        create: jest.fn().mockResolvedValue({ id: 'a1' }),
        update: jest.fn(),
      },
      labAdapterBranch: { updateMany: jest.fn(), createMany: jest.fn() },
      labAdapterTest: { updateMany: jest.fn(), createMany: jest.fn() },
    };
    const branchLabTestFindMany = jest.fn(
      ({
        where,
      }: {
        where: { id: { in: string[] }; branchId?: { in: string[] } };
      }) =>
        Promise.resolve(
          where.id.in
            .filter(
              (id) =>
                !where.branchId ||
                where.branchId.in.includes(TEST_BRANCH[id] ?? ''),
            )
            .map((id) => ({ id, branchId: TEST_BRANCH[id] })),
        ),
    );
    const withTenant = jest.fn(
      (_tenantId: string, cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    );
    const prisma = {
      labAdapter: {
        findFirst: jest.fn().mockResolvedValue({ id: 'a1', equipmentId: 'e1' }),
      },
      labAdapterTest: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { branchLabTestId: 'blt-1' },
            { branchLabTestId: 'blt-2' },
          ]),
      },
      branchLabTest: { findMany: branchLabTestFindMany },
      withTenant,
    } as unknown as PrismaService;
    const branchService = {
      findById: jest.fn((id: string) => Promise.resolve({ id, name: id })),
    } as unknown as BranchService;
    const equipmentService = {
      findById: jest.fn().mockResolvedValue({ id: 'e1', labTests: [] }),
    } as unknown as EquipmentService;
    const service = new LabAdapterService(
      prisma,
      branchService,
      equipmentService,
    );
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue({} as LabAdapterWithRelations);
    return { service, tx, withTenant };
  }

  it('create rejects a manual test whose branch is not selected', async () => {
    const { service, withTenant } = makeWriteService();

    await expect(
      service.create(TENANT, null, {
        name: 'Bridge',
        equipmentId: 'e1',
        branchIds: ['b1'],
        labTestIds: ['blt-1', 'blt-2'],
      }),
    ).rejects.toBeInstanceOf(LabAdapterLabTestBranchMismatchException);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('update rejects a manual test whose branch was removed', async () => {
    const { service, withTenant } = makeWriteService();

    await expect(
      service.update('a1', TENANT, null, {
        branchIds: ['b1'],
        labTestIds: ['blt-2'],
      }),
    ).rejects.toBeInstanceOf(LabAdapterLabTestBranchMismatchException);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it("update with only branchIds drops the removed branch's tests", async () => {
    const { service, tx } = makeWriteService();

    await service.update('a1', TENANT, null, { branchIds: ['b1'] });

    expect(tx.labAdapterTest.updateMany).toHaveBeenCalled();
    expect(tx.labAdapterTest.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenantId: TENANT,
          labAdapterId: 'a1',
          branchLabTestId: 'blt-1',
          sortOrder: 0,
        },
      ],
    });
  });
});
