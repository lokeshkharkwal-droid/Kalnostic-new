import { BranchLabTest, Prisma } from '@prisma/client';
import { BranchLabTestListService } from './branch-lab-test-list.service';
import { BranchLabTestListNameConflictException } from './exceptions/branch-lab-test-list.exceptions';

/**
 * Unit tests for list create/clone. These guard the production fix for large
 * branches: copying a list's rows must be ONE bulk `createMany` inside a
 * transaction with an explicit timeout (a per-row insert loop blew the 5s default
 * at ~1.8k tests), and a concurrent duplicate name must surface as a 409.
 *
 * Prisma is stubbed: `withTenant(id, cb, opts)` runs `cb(tx)` and records `opts`.
 */
const TENANT = 't1';
const BRANCH = 'b1';
const ACTOR = 'p1';
const DEFAULT_LIST = { id: 'default-list', isDefault: true };

function makeRow(i: number, overrides: Partial<BranchLabTest> = {}) {
  return {
    id: `row-${i}`,
    tenantId: TENANT,
    branchId: BRANCH,
    listId: DEFAULT_LIST.id,
    priceMsrp: 1000 + i,
    priceMaximum: 2000 + i,
    priceMinimum: 500 + i,
    priceOriginal: 900 + i,
    franchisePrice: 800 + i,
    listPrice: 1234,
    isDefault: true,
    isDuplicate: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as unknown as BranchLabTest;
}

function makeService(rows: BranchLabTest[]) {
  const tx = {
    branchLabTest: {
      findMany: jest.fn().mockResolvedValue(rows),
      create: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: rows.length }),
    },
    branchLabTestList: {
      create: jest.fn().mockResolvedValue({ id: 'new-list' }),
    },
  };
  const withTenant = jest.fn(
    (_id: string, cb: (t: unknown) => unknown, _opts?: unknown) => cb(tx),
  );
  const prisma = {
    withTenant,
    branchLabTestList: {
      findFirst: jest.fn(({ where }: { where: { isDefault?: boolean } }) =>
        Promise.resolve(where.isDefault ? DEFAULT_LIST : null),
      ),
    },
  };
  const service = new BranchLabTestListService(prisma as never);
  return { service, tx, withTenant };
}

/** The `data` array passed to the (single) `createMany` call. */
function copiedRows(tx: ReturnType<typeof makeService>['tx']) {
  const calls = tx.branchLabTest.createMany.mock.calls as [
    { data: Record<string, unknown>[] },
  ][];
  const first = calls[0];
  if (!first) throw new Error('createMany was not called');
  return first[0].data;
}

describe('BranchLabTestListService', () => {
  describe('create', () => {
    it('copies all default-list rows with one createMany inside a timed transaction', async () => {
      const rows = Array.from({ length: 1821 }, (_, i) => makeRow(i));
      const { service, tx, withTenant } = makeService(rows);

      const list = await service.create(TENANT, BRANCH, ACTOR, {
        name: 'sample list',
        copyPriceFrom: 'MSRP',
        priceType: 'CUSTOMIZED',
      });

      expect(list).toEqual({ id: 'new-list' });
      expect(withTenant).toHaveBeenCalledWith(
        TENANT,
        expect.any(Function),
        expect.objectContaining({ timeout: 15000 }),
      );
      expect(tx.branchLabTest.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ listId: DEFAULT_LIST.id }) as object,
      });
      expect(tx.branchLabTest.create).not.toHaveBeenCalled();
      expect(tx.branchLabTest.createMany).toHaveBeenCalledTimes(1);
      const data = copiedRows(tx);
      expect(data).toHaveLength(1821);
      expect(data[0]).toMatchObject({
        listId: 'new-list',
        listPrice: 1000,
        isDefault: true,
        isDuplicate: false,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
      expect(data[0]).not.toHaveProperty('id');
      expect(data[0]).not.toHaveProperty('createdAt');
    });

    it('computes PERCENTAGE prices from the chosen source column', async () => {
      const { service, tx } = makeService([makeRow(0)]);

      await service.create(TENANT, BRANCH, ACTOR, {
        name: 'half max',
        copyPriceFrom: 'MAXIMUM',
        priceType: 'PERCENTAGE',
        copyPercentage: 50,
      });

      const data = copiedRows(tx);
      expect(data[0]).toMatchObject({ listPrice: 1000 });
    });

    it('maps a concurrent duplicate-name unique violation to a 409', async () => {
      const { service, tx } = makeService([makeRow(0)]);
      tx.branchLabTestList.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create(TENANT, BRANCH, ACTOR, {
          name: 'dup',
          copyPriceFrom: 'MSRP',
          priceType: 'CUSTOMIZED',
        }),
      ).rejects.toBeInstanceOf(BranchLabTestListNameConflictException);
      expect(tx.branchLabTest.createMany).not.toHaveBeenCalled();
    });

    it('rethrows non-unique errors unchanged', async () => {
      const { service, tx } = makeService([makeRow(0)]);
      const boom = new Error('boom');
      tx.branchLabTestList.create.mockRejectedValue(boom);

      await expect(
        service.create(TENANT, BRANCH, ACTOR, {
          name: 'x',
          copyPriceFrom: 'MSRP',
          priceType: 'CUSTOMIZED',
        }),
      ).rejects.toBe(boom);
    });
  });

  describe('clone', () => {
    it('copies source rows with one createMany, preserving price and flags', async () => {
      const rows = [
        makeRow(0, { listPrice: 777 }),
        makeRow(1, { isDefault: false, isDuplicate: true }),
      ];
      const { service, tx, withTenant } = makeService(rows);
      jest.spyOn(service, 'findById').mockResolvedValue({
        id: 'src',
        priceType: 'CUSTOMIZED',
        copyPriceFrom: 'MSRP',
        copyPercentage: null,
      } as never);

      await service.clone('src', TENANT, BRANCH, ACTOR, { name: 'copy' });

      expect(withTenant).toHaveBeenCalledWith(
        TENANT,
        expect.any(Function),
        expect.objectContaining({ timeout: 15000 }),
      );
      expect(tx.branchLabTest.create).not.toHaveBeenCalled();
      const data = copiedRows(tx);
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({ listId: 'new-list', listPrice: 777 });
      expect(data[1]).toMatchObject({ isDefault: false, isDuplicate: true });
    });
  });
});
