import { DataSource, LabTest, Prisma, TatUnit } from '@prisma/client';
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
      createdAt: new Date('2026-01-01'),
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
      update: jest.Mock;
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
    branchLabTestList: { findFirst: jest.Mock };
    branchLabTest: {
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findFirst: jest.Mock;
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
        update: jest.fn().mockResolvedValue({}),
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
      // Branch Lab Test List cascade: no default (Walk-in) list by default, so
      // `cascadeDeleteBranchLabTestCopies` no-ops unless a test opts in.
      branchLabTestList: { findFirst: jest.fn().mockResolvedValue(null) },
      branchLabTest: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
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

  it('adopts a stale-linked branch test by name when the tenant test was re-created under a new code', async () => {
    // Tenant soft-deleted `old-src` and re-created the same-named test with a
    // new code; the branch copy still links to `old-src`. Creating a fresh clone
    // would trip the (tenant, master_data, test_name) unique index.
    const src = test({
      id: 'new-src',
      testCode: 'GGT',
      testName: 'GGT, Serum',
    });
    const branch = test({
      id: 'branch-1',
      testCode: 'GGTGS',
      testName: 'GGT, Serum',
      sourceMasterLabTestId: 'old-src',
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([src])
      .mockResolvedValueOnce([branch]);

    const result = await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    expect(result).toMatchObject({ created: 0, updated: 1, deleted: 0 });
    expect(result.testIdMap.get('new-src')).toBe('branch-1');
    expect(prismaMock.labTest.create).not.toHaveBeenCalled();
    const [updateArgs] = prismaMock.labTest.update.mock.calls[0] as [
      { where: { id: string }; data: { sourceMasterLabTestId: string } },
    ];
    expect(updateArgs.where).toEqual({ id: 'branch-1' });
    expect(updateArgs.data.sourceMasterLabTestId).toBe('new-src');
    // Adopted, so not soft-deleted as an orphan of `old-src`.
    expect(prismaMock.labTest.update).toHaveBeenCalledTimes(1);
  });

  it('soft-deletes orphans before cloning new tenant tests', async () => {
    const src = test({ id: 'src-new', testCode: 'NEW', testName: 'New' });
    const orphan = test({
      id: 'branch-orphan',
      testCode: 'OLD',
      testName: 'Old',
      sourceMasterLabTestId: 'gone',
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([src])
      .mockResolvedValueOnce([orphan]);

    const result = await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    expect(result).toMatchObject({ created: 1, updated: 0, deleted: 1 });
    const [deleteOrder] = prismaMock.labTest.update.mock.invocationCallOrder;
    const [createOrder] = prismaMock.labTest.create.mock.invocationCallOrder;
    expect(deleteOrder).toBeLessThan(createOrder!);
  });

  it('soft-deletes an orphan before renaming another branch test onto its name', async () => {
    // Tenant deleted `gone` ("GGT, Serum") and renamed `src-y` to "GGT, Serum".
    const src = test({ id: 'src-y', testCode: 'Y', testName: 'GGT, Serum' });
    const branchY = test({
      id: 'branch-y',
      testCode: 'Y',
      testName: 'Old Y',
      sourceMasterLabTestId: 'src-y',
    });
    const orphan = test({
      id: 'branch-orphan',
      testCode: 'GGTGS',
      testName: 'GGT, Serum',
      sourceMasterLabTestId: 'gone',
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([src])
      .mockResolvedValueOnce([branchY, orphan]);

    const result = await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    expect(result).toMatchObject({ created: 0, updated: 1, deleted: 1 });
    const updatedIds = (
      prismaMock.labTest.update.mock.calls as [{ where: { id: string } }][]
    ).map(([args]) => args.where.id);
    expect(updatedIds).toEqual(['branch-orphan', 'branch-y']);
  });

  it.each([
    ['source-linked test first', ['src-2', 'src-1']],
    ['re-created test first', ['src-1', 'src-2']],
  ])(
    'never lets a name match steal a source-linked branch row (%s)',
    async (_label, order) => {
      // Tenant renamed `src-2` from "N" to "M" and created `src-1` named "N";
      // the branch copy of `src-2` must stay with `src-2` in any order.
      const tenant: Record<string, LabTest> = {
        'src-1': test({ id: 'src-1', testCode: 'NEW', testName: 'N' }),
        'src-2': test({ id: 'src-2', testCode: 'C2', testName: 'M' }),
      };
      const branch = test({
        id: 'branch-2',
        testCode: 'C2',
        testName: 'N',
        sourceMasterLabTestId: 'src-2',
      });
      prismaMock.labTest.findMany
        .mockResolvedValueOnce(order.map((id) => tenant[id]))
        .mockResolvedValueOnce([branch]);

      const result = await service.syncTestsIntoBranch(
        prismaMock as unknown as Prisma.TransactionClient,
        baseParams,
      );

      expect(result).toMatchObject({ created: 1, updated: 1, deleted: 0 });
      expect(result.testIdMap.get('src-2')).toBe('branch-2');
      expect(result.testIdMap.get('src-1')).toBe('new-branch-test');
      // The rename to "M" lands before the clone that reuses "N".
      const [updateOrder] = prismaMock.labTest.update.mock.invocationCallOrder;
      const [createOrder] = prismaMock.labTest.create.mock.invocationCallOrder;
      expect(updateOrder).toBeLessThan(createOrder!);
    },
  );

  it('parks swapped names on a placeholder so two tenant tests can swap names', async () => {
    const srcA = test({ id: 'src-a', testCode: 'A', testName: 'Beta' });
    const srcB = test({ id: 'src-b', testCode: 'B', testName: 'Alpha' });
    const branchA = test({
      id: 'branch-a',
      testCode: 'A',
      testName: 'Alpha',
      sourceMasterLabTestId: 'src-a',
    });
    const branchB = test({
      id: 'branch-b',
      testCode: 'B',
      testName: 'Beta',
      sourceMasterLabTestId: 'src-b',
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([srcA, srcB])
      .mockResolvedValueOnce([branchA, branchB]);

    const result = await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    expect(result).toMatchObject({ created: 0, updated: 2, deleted: 0 });
    const calls = (
      prismaMock.labTest.update.mock.calls as [
        { where: { id: string }; data: { testName?: string } },
      ][]
    ).map(([args]) => [args.where.id, args.data.testName]);
    expect(calls).toEqual([
      ['branch-a', '__import__branch-a'],
      ['branch-b', '__import__branch-b'],
      ['branch-a', 'Beta'],
      ['branch-b', 'Alpha'],
    ]);
  });

  it('keeps the oldest of two branch rows linked to the same tenant test and soft-deletes the other', async () => {
    const src = test({ id: 'src-1', testCode: 'T1', testName: 'T1' });
    const newer = test({
      id: 'branch-newer',
      testCode: 'T1-COPY',
      testName: 'T1 copy',
      sourceMasterLabTestId: 'src-1',
      createdAt: new Date('2026-06-01'),
    });
    const older = test({
      id: 'branch-older',
      testCode: 'T1-OLD',
      testName: 'T1 old',
      sourceMasterLabTestId: 'src-1',
      createdAt: new Date('2026-01-01'),
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([src])
      .mockResolvedValueOnce([newer, older]);

    const result = await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    expect(result).toMatchObject({ created: 0, updated: 1, deleted: 1 });
    expect(result.testIdMap.get('src-1')).toBe('branch-older');
    const updatedIds = (
      prismaMock.labTest.update.mock.calls as [{ where: { id: string } }][]
    ).map(([args]) => args.where.id);
    expect(updatedIds).toEqual(['branch-newer', 'branch-older']);
  });

  it('never adopts a hand-created branch test by name — rejects with a 409 before any write', async () => {
    const src = test({ id: 'src-1', testCode: 'GGT', testName: 'GGT, Serum' });
    const handMade = test({
      id: 'branch-hand',
      testCode: 'MY-GGT',
      testName: 'GGT, Serum',
      sourceMasterLabTestId: null,
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([src])
      .mockResolvedValueOnce([handMade]);

    await expect(
      service.syncTestsIntoBranch(
        prismaMock as unknown as Prisma.TransactionClient,
        baseParams,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'MASTER_DATA_IMPORT_CONFLICT' } },
    });
    expect(prismaMock.labTest.update).not.toHaveBeenCalled();
    expect(prismaMock.labTest.create).not.toHaveBeenCalled();
  });

  it('keeps a param whose code changed upstream by matching it on name', async () => {
    const src = test({ id: 'src-1', testCode: 'T1' });
    const branch = test({
      id: 'branch-1',
      testCode: 'T1',
      sourceMasterLabTestId: 'src-1',
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([src])
      .mockResolvedValueOnce([branch]);
    prismaMock.labTestResultParam.findMany
      .mockResolvedValueOnce([
        { id: 'old-param', parameterCode: 'HB', parameterName: 'Haemoglobin' },
      ]) // existing branch params
      .mockResolvedValueOnce([
        {
          id: 'src-param',
          parameterCode: 'HGB',
          parameterName: 'haemoglobin ',
        },
      ]); // source params

    await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    // Patched in place (same id, new code) — not recreated, not dropped.
    expect(prismaMock.labTestResultParam.create).not.toHaveBeenCalled();
    expect(prismaMock.labTestResultParam.update).toHaveBeenCalledTimes(1);
    const [paramUpdate] = prismaMock.labTestResultParam.update.mock
      .calls[0] as [{ where: { id: string }; data: { parameterCode: string } }];
    expect(paramUpdate.where).toEqual({ id: 'old-param' });
    expect(paramUpdate.data.parameterCode).toBe('HGB');
    expect(prismaMock.labTestResultParam.updateMany).not.toHaveBeenCalled();
  });

  it('reports progress: plan, removal, tests phase, processed count', async () => {
    const srcA = test({ id: 'src-a', testCode: 'A', testName: 'A' });
    const srcB = test({ id: 'src-b', testCode: 'B', testName: 'B' });
    const branchA = test({
      id: 'branch-a',
      testCode: 'A',
      testName: 'A',
      sourceMasterLabTestId: 'src-a',
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([srcA, srcB])
      .mockResolvedValueOnce([branchA]);
    const events: unknown[] = [];

    await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
      (e) => {
        events.push(e);
      },
    );

    expect(events).toEqual([
      { type: 'tests-planned', total: 2, toUpdate: 1, toCreate: 1 },
      { type: 'phase', phase: 'REMOVING', count: 0 },
      { type: 'phase', phase: 'TESTS' },
      { type: 'tests-processed', processed: 2 },
    ]);
  });

  it('reports nothing when the pre-flight rejects the import', async () => {
    const src = test({ id: 'src-1', testCode: 'X', testName: 'Clash' });
    const handMade = test({ id: 'hand', testCode: 'Y', testName: 'Clash' });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([src])
      .mockResolvedValueOnce([handMade]);
    const listener = jest.fn();

    await expect(
      service.syncTestsIntoBranch(
        prismaMock as unknown as Prisma.TransactionClient,
        baseParams,
        listener,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(listener).not.toHaveBeenCalled();
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

  it("propagates a matched test's TAT to its Lab Test List copies in every list, keeping branch-customised TAT", async () => {
    const hours = (min: number | null, max: number | null) => ({
      tatMinValue: min,
      tatMinUnit: TatUnit.HOURS,
      tatMaxValue: max,
      tatMaxUnit: TatUnit.HOURS,
    });
    const src = test({ id: 'src-1', testCode: 'T1', ...hours(4, 8) });
    const branch = test({
      id: 'branch-1',
      testCode: 'T1',
      sourceMasterLabTestId: 'src-1',
      ...hours(2, 6),
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([src])
      .mockResolvedValueOnce([branch]);
    prismaMock.branchLabTest.findMany.mockResolvedValueOnce([
      {
        id: 'walk-in-empty',
        sourceLabTestId: 'branch-1',
        ...hours(null, null),
      },
      { id: 'pt-list-old', sourceLabTestId: 'branch-1', ...hours(2, 6) },
      { id: 'referral-custom', sourceLabTestId: 'branch-1', ...hours(1, 3) },
      { id: 'already-new', sourceLabTestId: 'branch-1', ...hours(4, 8) },
    ]);

    await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    const [[findArgs]] = prismaMock.branchLabTest.findMany.mock.calls as [
      [{ where: unknown }],
    ];
    expect(findArgs.where).toEqual({
      tenantId: 'tenant-1',
      branchId: 'branch-1',
      deletedAt: null,
      isDuplicate: false,
      sourceLabTestId: { in: ['branch-1'] },
    });
    expect(prismaMock.branchLabTest.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.branchLabTest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['walk-in-empty', 'pt-list-old'] } },
      data: hours(4, 8),
    });
  });

  it('writes no Lab Test List copies when every copy is customised or current', async () => {
    const src = test({ id: 'src-1', testCode: 'T1', tatMinValue: 2 });
    const branch = test({
      id: 'branch-1',
      testCode: 'T1',
      sourceMasterLabTestId: 'src-1',
      tatMinValue: 2,
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([src])
      .mockResolvedValueOnce([branch]);
    prismaMock.branchLabTest.findMany.mockResolvedValueOnce([
      { id: 'current', sourceLabTestId: 'branch-1', tatMinValue: 2 },
      { id: 'custom', sourceLabTestId: 'branch-1', tatMinValue: 9 },
    ]);

    await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    expect(prismaMock.branchLabTest.updateMany).not.toHaveBeenCalled();
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

  it('also soft-deletes the branch Lab Test List copy of an orphaned branch test, promoting a duplicate sibling to default', async () => {
    const orphan = test({
      id: 'orphan-1',
      testCode: 'GONE',
      sourceMasterLabTestId: 'deleted-tenant-test',
    });
    prismaMock.labTest.findMany
      .mockResolvedValueOnce([]) // sourceTests: nothing active tenant-side
      .mockResolvedValueOnce([orphan]); // branchTests
    prismaMock.branchLabTestList.findFirst.mockResolvedValueOnce({
      id: 'walk-in-list',
    });
    const copy = {
      id: 'branch-copy-1',
      isDefault: true,
      sourceLabTestId: 'orphan-1',
    };
    prismaMock.branchLabTest.findMany.mockResolvedValueOnce([copy]);
    const sibling = { id: 'branch-copy-dup', isDefault: false };
    prismaMock.branchLabTest.findFirst.mockResolvedValueOnce(sibling);

    const result = await service.syncTestsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
    );

    expect(result).toMatchObject({ created: 0, updated: 0, deleted: 1 });
    expect(prismaMock.branchLabTest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          listId: 'walk-in-list',
          isDuplicate: false,
          sourceLabTestId: { in: ['orphan-1'] },
        }),
      }),
    );
    expect(prismaMock.branchLabTest.update).toHaveBeenCalledWith({
      where: { id: 'branch-copy-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(prismaMock.branchLabTest.update).toHaveBeenCalledWith({
      where: { id: 'branch-copy-dup' },
      data: { isDefault: true },
    });
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
