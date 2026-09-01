import { DataSource, LabPanel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from '../lab-test/lab-test.service';
import { LabPanelService } from './lab-panel.service';

/**
 * Unit coverage for the Tenant→Branch Master Data sync's panel add/update/
 * delete reconciliation (`syncPanelsIntoBranch`, private — exercised directly
 * since it holds 100% of the panel-side sync logic and the controller/
 * `syncTenantToBranch` orchestration around it is a thin passthrough): a new
 * tenant panel is cloned, a matched one is overwritten + membership rebuilt,
 * and a branch panel whose tenant source has been soft-deleted is itself
 * soft-deleted (cascading its membership) — UNLESS it was never sync-derived
 * (`sourceMasterLabPanelId` null), which must always be left untouched.
 */
describe('LabPanelService.syncPanelsIntoBranch', () => {
  const panel = (overrides: Partial<LabPanel>) =>
    ({
      id: 'id',
      tenantId: 'tenant-1',
      panelCode: 'CODE',
      panelName: 'Panel',
      source: DataSource.TENANT,
      sourceMasterLabPanelId: null,
      ...overrides,
    }) as unknown as LabPanel;

  const baseParams = {
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    tenantMasterDataId: 'tenant-md',
    branchMasterDataId: 'branch-md',
  };

  let prismaMock: {
    labPanel: { findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    labPanelTest: {
      findMany: jest.Mock;
      createMany: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let masterDataMock: Record<string, jest.Mock>;
  let labTestServiceMock: Record<string, jest.Mock>;
  let service: LabPanelService;
  /** `syncPanelsIntoBranch` is private — call it via this narrowly-typed accessor. */
  let syncPanelsIntoBranch: (
    tx: Prisma.TransactionClient,
    params: typeof baseParams,
    testIdMap: Map<string, string>,
  ) => Promise<{ created: number; updated: number; deleted: number }>;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock = {
      labPanel: {
        findMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'new-branch-panel' }),
        update: jest.fn().mockResolvedValue({}),
      },
      labPanelTest: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    masterDataMock = {};
    labTestServiceMock = {};
    service = new LabPanelService(
      prismaMock as unknown as PrismaService,
      masterDataMock as unknown as MasterDataService,
      labTestServiceMock as unknown as LabTestService,
    );
    syncPanelsIntoBranch = (
      service as unknown as {
        syncPanelsIntoBranch: typeof syncPanelsIntoBranch;
      }
    ).syncPanelsIntoBranch.bind(service);
  });

  it('clones an unmatched tenant panel into the branch (add)', async () => {
    const src = panel({ id: 'src-1', panelCode: 'P1' });
    prismaMock.labPanel.findMany
      .mockResolvedValueOnce([src]) // sourcePanels
      .mockResolvedValueOnce([]); // branchPanels

    const result = await syncPanelsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
      new Map(),
    );

    expect(result).toMatchObject({ created: 1, updated: 0, deleted: 0 });
    expect(prismaMock.labPanel.create).toHaveBeenCalledTimes(1);
  });

  it('overwrites a matched branch panel and rebuilds its membership (update)', async () => {
    const src = panel({ id: 'src-1', panelCode: 'P1' });
    const branch = panel({
      id: 'branch-1',
      panelCode: 'P1',
      sourceMasterLabPanelId: 'src-1',
    });
    prismaMock.labPanel.findMany
      .mockResolvedValueOnce([src])
      .mockResolvedValueOnce([branch]);

    const result = await syncPanelsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
      new Map(),
    );

    expect(result).toMatchObject({ created: 0, updated: 1, deleted: 0 });
    expect(prismaMock.labPanel.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'branch-1' } }),
    );
  });

  it('soft-deletes (cascading membership) a previously-synced branch panel whose tenant source no longer exists', async () => {
    const orphan = panel({
      id: 'orphan-1',
      panelCode: 'GONE',
      sourceMasterLabPanelId: 'deleted-tenant-panel',
    });
    prismaMock.labPanel.findMany
      .mockResolvedValueOnce([]) // sourcePanels: nothing active tenant-side
      .mockResolvedValueOnce([orphan]); // branchPanels

    const result = await syncPanelsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
      new Map(),
    );

    expect(result).toMatchObject({ created: 0, updated: 0, deleted: 1 });
    expect(prismaMock.labPanelTest.updateMany).toHaveBeenCalledWith({
      where: { labPanelId: 'orphan-1', tenantId: 'tenant-1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(prismaMock.labPanel.update).toHaveBeenCalledWith({
      where: { id: 'orphan-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('never touches a branch panel that was never synced from the tenant (sourceMasterLabPanelId null)', async () => {
    const independent = panel({
      id: 'indep-1',
      panelCode: 'INDEPENDENT',
      sourceMasterLabPanelId: null,
    });
    prismaMock.labPanel.findMany
      .mockResolvedValueOnce([]) // sourcePanels: nothing tenant-side, even by code
      .mockResolvedValueOnce([independent]); // branchPanels

    const result = await syncPanelsIntoBranch(
      prismaMock as unknown as Prisma.TransactionClient,
      baseParams,
      new Map(),
    );

    expect(result.deleted).toBe(0);
    expect(prismaMock.labPanel.update).not.toHaveBeenCalled();
    expect(prismaMock.labPanelTest.updateMany).not.toHaveBeenCalled();
  });
});
