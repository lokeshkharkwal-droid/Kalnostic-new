import { DataSource, LabTest, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from './lab-test.service';

/**
 * Unit coverage for the Site Admin bulk-import orchestration: per-template
 * skip/import/fail aggregation, origin tracking (`clonedFromId`), and mapping a
 * unique-constraint violation to a friendly per-row failure.
 */
describe('LabTestService.importTemplates', () => {
  const template = (id: string) =>
    ({
      id,
      tenantId: null,
      source: DataSource.SITE_ADMIN,
      testName: `Test ${id}`,
      testCode: `CODE_${id}`,
    }) as unknown as Prisma.LabTestGetPayload<object>;

  let prismaMock: {
    labTest: { findMany: jest.Mock; create: jest.Mock };
    labTestSample: { findMany: jest.Mock };
    labTestResultParam: { findMany: jest.Mock };
    withTenant: jest.Mock;
  };
  let masterDataMock: { findById: jest.Mock };
  let service: LabTestService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock = {
      labTest: {
        findMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'new-test' }),
      },
      labTestSample: { findMany: jest.fn().mockResolvedValue([]) },
      labTestResultParam: { findMany: jest.fn().mockResolvedValue([]) },
      // Run the callback against `prismaMock` itself as the tx client.
      withTenant: jest.fn((_tenantId: string, cb: (tx: unknown) => unknown) =>
        cb(prismaMock),
      ),
    };
    masterDataMock = {
      findById: jest.fn().mockResolvedValue({ branchId: 'b1' }),
    };
    service = new LabTestService(
      prismaMock as unknown as PrismaService,
      masterDataMock as unknown as MasterDataService,
    );
  });

  it('skips already-imported templates, imports the rest, and reports missing ones', async () => {
    // Requested: tA (already imported), tB (fresh), tMissing (not a template).
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([template('tA'), template('tB')]) // templates by id
      .mockResolvedValueOnce([{ clonedFromId: 'tA' }]); // already imported here

    const result = await service.importTemplates('tenant-1', 'actor-1', {
      masterDataId: 'md-1',
      templateIds: ['tA', 'tB', 'tMissing'],
    });

    expect(masterDataMock.findById).toHaveBeenCalledWith('md-1', 'tenant-1');
    expect(result.skipped.map((o) => o.templateId)).toEqual(['tA']);
    expect(result.imported.map((o) => o.templateId)).toEqual(['tB']);
    expect(result.failed.map((o) => o.templateId)).toEqual(['tMissing']);

    // Origin tracking: the fresh clone records clonedFromId = template id.
    expect(prismaMock.labTest.create).toHaveBeenCalledTimes(1);
    const createCalls = prismaMock.labTest.create.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(createCalls[0]?.[0]?.data).toMatchObject({
      tenantId: 'tenant-1',
      branchId: 'b1',
      masterDataId: 'md-1',
      source: DataSource.TENANT,
      clonedFromId: 'tB',
    });
  });

  it('records a name/code conflict as a failed row without aborting the batch', async () => {
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([template('tB')])
      .mockResolvedValueOnce([]); // none imported yet
    prismaMock.withTenant.mockImplementationOnce(() => {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['lab_test_test_code_key'] },
      });
    });

    const result = await service.importTemplates('tenant-1', 'actor-1', {
      masterDataId: 'md-1',
      templateIds: ['tB'],
    });

    expect(result.imported).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ templateId: 'tB' });
    expect(result.failed[0]?.reason).toContain('already exists');
  });
});

/**
 * Unit coverage for the Tenant→Branch Master Data sync's add/update/delete
 * reconciliation: a new tenant test is cloned, a matched one is overwritten in
 * place, and a branch test whose tenant source has been soft-deleted is itself
 * soft-deleted (cascading to children) — UNLESS it was never sync-derived
 * (`sourceMasterLabTestId` null), which must always be left untouched.
 */
describe('LabTestService.syncTestsIntoBranch', () => {
  const test = (overrides: Partial<LabTest>) =>
    ({
      id: 'id',
      tenantId: 'tenant-1',
      testCode: 'CODE',
      testName: 'Test',
      source: DataSource.TENANT,
      sourceMasterLabTestId: null,
      versionHistory: [],
      ...overrides,
    }) as unknown as LabTest;

  const baseParams = {
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    tenantMasterDataId: 'tenant-md',
    branchMasterDataId: 'branch-md',
    actorId: 'actor-1',
  };

  let prismaMock: {
    labTest: { findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    labTestSample: {
      findMany: jest.Mock;
      createMany: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
    };
    labTestResultParam: {
      findMany: jest.Mock;
      create: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
    };
    labTestReferenceRange: {
      findMany: jest.Mock;
      createMany: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
    };
    labTestReferenceValue: {
      findMany: jest.Mock;
      createMany: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let masterDataMock: { findById: jest.Mock };
  let service: LabTestService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock = {
      labTest: {
        findMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'new-branch-test' }),
        update: jest.fn().mockResolvedValue({}),
      },
      labTestSample: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
      labTestResultParam: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
      labTestReferenceRange: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
      labTestReferenceValue: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    masterDataMock = { findById: jest.fn() };
    service = new LabTestService(
      prismaMock as unknown as PrismaService,
      masterDataMock as unknown as MasterDataService,
    );
  });

  it('clones an unmatched tenant test into the branch (add)', async () => {
    const src = test({ id: 'src-1', testCode: 'T1' });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([src]) // sourceTests
      .mockResolvedValueOnce([]); // branchTests

    const result = await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    expect(result).toMatchObject({ created: 1, updated: 0, deleted: 0 });
    expect(result.testIdMap.get('src-1')).toBe('new-branch-test');
    expect(prismaMock.labTest.create).toHaveBeenCalledTimes(1);
  });

  it('fully overwrites a matched branch test in place (update)', async () => {
    const src = test({ id: 'src-1', testCode: 'T1' });
    const branch = test({
      id: 'branch-1',
      testCode: 'T1',
      sourceMasterLabTestId: 'src-1',
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([src])
      .mockResolvedValueOnce([branch]);

    const result = await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    expect(result).toMatchObject({ created: 0, updated: 1, deleted: 0 });
    expect(prismaMock.labTest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'branch-1' } }),
    );
  });

  it('soft-deletes (cascading to children) a previously-synced branch test whose tenant source no longer exists', async () => {
    const orphan = test({
      id: 'orphan-1',
      testCode: 'GONE',
      sourceMasterLabTestId: 'deleted-tenant-test',
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([]) // sourceTests: nothing active tenant-side
      .mockResolvedValueOnce([orphan]); // branchTests

    const result = await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    expect(result).toMatchObject({ created: 0, updated: 0, deleted: 1 });
    expect(prismaMock.labTest.update).toHaveBeenCalledWith({
      where: { id: 'orphan-1' },
      data: { deletedAt: expect.any(Date) },
    });
    for (const child of [
      prismaMock.labTestReferenceRange.updateMany,
      prismaMock.labTestReferenceValue.updateMany,
      prismaMock.labTestResultParam.updateMany,
      prismaMock.labTestSample.updateMany,
    ]) {
      expect(child).toHaveBeenCalledWith({
        where: { labTestId: 'orphan-1', tenantId: 'tenant-1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    }
  });

  it('never touches a branch test that was never synced from the tenant (sourceMasterLabTestId null)', async () => {
    const independent = test({
      id: 'indep-1',
      testCode: 'INDEPENDENT',
      sourceMasterLabTestId: null,
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([]) // sourceTests: nothing tenant-side, even by code
      .mockResolvedValueOnce([independent]); // branchTests

    const result = await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    expect(result.deleted).toBe(0);
    expect(prismaMock.labTest.update).not.toHaveBeenCalled();
    expect(prismaMock.labTestReferenceRange.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.labTestReferenceValue.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.labTestResultParam.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.labTestSample.updateMany).not.toHaveBeenCalled();
  });
});
