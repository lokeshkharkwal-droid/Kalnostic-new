import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import {
  MasterDataService,
  TENANT_MASTER_DATA_NAME,
} from './master-data.service';

/**
 * Unit coverage for the tenant-level "Tenant Master Data" singleton
 * (get-or-create with a branch_id = NULL row, fixed name, race-safe on the
 * partial-unique index).
 */
describe('MasterDataService.getOrCreateTenantMasterData', () => {
  let prismaMock: { masterData: { findFirst: jest.Mock; create: jest.Mock } };
  let service: MasterDataService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock = {
      masterData: { findFirst: jest.fn(), create: jest.fn() },
    };
    service = new MasterDataService(
      prismaMock as unknown as PrismaService,
      {} as unknown as BranchService,
    );
  });

  it('returns the existing tenant master data without creating a second', async () => {
    prismaMock.masterData.findFirst.mockResolvedValue({
      id: 'tmd-1',
      tenantId: 't1',
      branchId: null,
    });

    const result = await service.getOrCreateTenantMasterData('t1');

    expect(result).toMatchObject({ id: 'tmd-1', branchId: null });
    expect(prismaMock.masterData.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 't1', branchId: null, deletedAt: null },
    });
    expect(prismaMock.masterData.create).not.toHaveBeenCalled();
  });

  it('creates a NULL-branch "Tenant Master Data" on first access', async () => {
    prismaMock.masterData.findFirst.mockResolvedValue(null);
    prismaMock.masterData.create.mockResolvedValue({
      id: 'tmd-new',
      tenantId: 't1',
      branchId: null,
      name: TENANT_MASTER_DATA_NAME,
    });

    const result = await service.getOrCreateTenantMasterData('t1');

    expect(result.id).toBe('tmd-new');
    expect(prismaMock.masterData.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        branchId: null,
        name: TENANT_MASTER_DATA_NAME,
        description: null,
      },
    });
  });

  it('re-reads and returns the winner when a concurrent create races (P2002)', async () => {
    prismaMock.masterData.findFirst
      .mockResolvedValueOnce(null) // initial lookup: none
      .mockResolvedValueOnce({
        id: 'tmd-race',
        tenantId: 't1',
        branchId: null,
      }); // post-conflict re-read
    prismaMock.masterData.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await service.getOrCreateTenantMasterData('t1');

    expect(result.id).toBe('tmd-race');
  });
});
