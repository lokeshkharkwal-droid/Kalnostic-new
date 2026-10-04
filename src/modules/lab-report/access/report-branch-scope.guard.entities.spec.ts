import { Reflector } from '@nestjs/core';
import { LabReportStatus } from '@prisma/client';
import type { ExecutionContext } from '@nestjs/common';
import {
  ReportBranchScopeGuard,
  type ReportBranchEntity,
} from './report-branch-scope.guard';

const A = 'branch-A';
const B = 'branch-B';

const MODELS: Array<[ReportBranchEntity, string]> = [
  ['criticalAlert', 'criticalAlert'],
  ['reRunRequest', 'reRunRequest'],
  ['outOfRangeFlag', 'outOfRangeFlag'],
  ['deltaCheck', 'deltaCheck'],
  ['scheduledTest', 'scheduledTest'],
];

function setup(
  entity: ReportBranchEntity,
  model: string,
  row: {
    branchId: string | null;
    labReport: { status: LabReportStatus };
  } | null,
  canSee: { branchId: string; profileKey: string | null } | null,
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue({ entity }),
  } as unknown as Reflector;
  const finders: Record<string, jest.Mock> = {};
  const prisma: Record<string, unknown> = {
    runWithTenant: jest.fn((_t: string, fn: () => Promise<unknown>) => fn()),
  };
  for (const [, m] of MODELS) {
    finders[m] = jest.fn().mockResolvedValue(m === model ? row : null);
    prisma[m] = { findFirst: finders[m] };
  }
  prisma.labReport = { findFirst: jest.fn().mockResolvedValue(null) };
  const access = { canSee: jest.fn().mockResolvedValue(canSee) };
  const user = {
    tenant_id: 't1',
    person_id: 'p1',
    active_branch_id: A as string | null,
    active_profile_key: 'lab_technician' as string | null,
  };
  const request = { user, params: { id: 'row-1' } };
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const guard = new ReportBranchScopeGuard(
    reflector,
    prisma as never,
    access as never,
  );
  return { guard, ctx, user, finders, access, prisma };
}

describe.each(MODELS)(
  'ReportBranchScopeGuard — %s rows belong to their report’s branch',
  (entity, model) => {
    it('looks the row up in ITS table (and no other) and re-points at its branch', async () => {
      const { guard, ctx, user, finders, prisma, access } = setup(
        entity,
        model,
        { branchId: B, labReport: { status: LabReportStatus.SAVED } },
        { branchId: B, profileKey: 'lab_supervisor' },
      );
      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      expect(finders[model]).toHaveBeenCalledTimes(1);
      for (const [, other] of MODELS) {
        if (other !== model) expect(finders[other]).not.toHaveBeenCalled();
      }
      expect(
        (prisma.labReport as { findFirst: jest.Mock }).findFirst,
      ).not.toHaveBeenCalled();
      // the row's report status (not the caller's) decides visibility there
      expect(access.canSee).toHaveBeenCalledWith(
        't1',
        'p1',
        { branchId: A, profileKey: 'lab_technician' },
        B,
        LabReportStatus.SAVED,
      );
      expect(user.active_branch_id).toBe(B);
      expect(user.active_profile_key).toBe('lab_supervisor');
    });

    it('does not re-point when the report’s status is hidden at that branch', async () => {
      const { guard, ctx, user } = setup(
        entity,
        model,
        { branchId: B, labReport: { status: LabReportStatus.APPROVED } },
        null, // canSee → null: no access / status not visible there
      );
      await guard.canActivate(ctx);
      expect(user.active_branch_id).toBe(A);
      expect(user.active_profile_key).toBe('lab_technician');
    });

    it('leaves an own-branch row alone without any access lookup', async () => {
      const { guard, ctx, user, access } = setup(
        entity,
        model,
        { branchId: A, labReport: { status: LabReportStatus.PENDING } },
        null,
      );
      await guard.canActivate(ctx);
      expect(access.canSee).not.toHaveBeenCalled();
      expect(user.active_branch_id).toBe(A);
    });

    it('passes through (so the handler 404s) when the row does not exist', async () => {
      const { guard, ctx, user, access } = setup(entity, model, null, null);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(access.canSee).not.toHaveBeenCalled();
      expect(user.active_branch_id).toBe(A);
    });
  },
);

describe('ReportBranchScopeGuard — never trusts a client-supplied branch', () => {
  it('ignores a caller with no active branch (nothing to compare, nothing to re-point)', async () => {
    const { guard, ctx, user, access } = setup(
      'criticalAlert',
      'criticalAlert',
      { branchId: B, labReport: { status: LabReportStatus.SAVED } },
      { branchId: B, profileKey: 'x' },
    );
    user.active_branch_id = null;
    await guard.canActivate(ctx);
    expect(access.canSee).not.toHaveBeenCalled();
    expect(user.active_branch_id).toBeNull();
  });
});
