import { DataSource, Prisma } from '@prisma/client';
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
