import { BranchStatus } from '@prisma/client';
import { BranchService } from './branch.service';

/**
 * Deleting a branch must detach everything that grants access through it, in
 * one transaction, so no stale branchId keeps working: assignments revoked,
 * user + branch-role overrides removed, module enablement disabled, and the
 * branch itself soft-deleted + INACTIVE. The main branch can't be deleted.
 */
const TENANT = 't1';
const BRANCH = 'b1';
const ACTOR = 'admin';

function makeService(mainBranchId = 'other') {
  const tx = {
    userBranchProfile: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    userBranchPermission: {
      deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
    },
    branchRolePermission: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    branchModule: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    branch: { update: jest.fn().mockResolvedValue({ id: BRANCH }) },
  };
  const prisma = {
    branch: {
      findFirst: jest.fn().mockResolvedValue({ id: BRANCH, tenantId: TENANT }),
    },
    tenantMainBranch: {
      findUnique: jest.fn().mockResolvedValue({ branchId: mainBranchId }),
    },
    withTenant: jest.fn((_t: string, cb: (t: unknown) => unknown) => cb(tx)),
  };
  const service = new BranchService(prisma as never, {} as never);
  return { service, tx, prisma };
}

describe('BranchService.remove', () => {
  it('revokes assignments, drops overrides, disables modules and soft-deletes the branch', async () => {
    const { service, tx } = makeService();

    await service.remove(BRANCH, TENANT, ACTOR);

    expect(tx.userBranchProfile.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, branchId: BRANCH, deletedAt: null },
      data: expect.objectContaining({
        isActive: false,
        isDefault: false,
        revokedBy: ACTOR,
      }) as object,
    });
    expect(tx.userBranchPermission.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, branchId: BRANCH },
    });
    expect(tx.branchRolePermission.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, branchId: BRANCH },
    });
    expect(tx.branchModule.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, branchId: BRANCH, deletedAt: null },
      data: expect.objectContaining({ isEnabled: false }) as object,
    });
    expect(tx.branch.update).toHaveBeenCalledWith({
      where: { id: BRANCH },
      data: expect.objectContaining({
        status: BranchStatus.INACTIVE,
      }) as object,
    });
  });

  it('refuses to delete the main branch and touches nothing', async () => {
    const { service, tx, prisma } = makeService(BRANCH);

    await expect(service.remove(BRANCH, TENANT, ACTOR)).rejects.toThrow();
    expect(prisma.withTenant).not.toHaveBeenCalled();
    expect(tx.userBranchProfile.updateMany).not.toHaveBeenCalled();
  });
});
