import { Reflector } from '@nestjs/core';
import { LabReportStatus } from '@prisma/client';
import type { ExecutionContext } from '@nestjs/common';
import {
  ReportBranchScopeGuard,
  type ReportBranchScopeMeta,
} from './report-branch-scope.guard';

const A = 'branch-A';
const B = 'branch-B';

function setup(opts: {
  meta?: ReportBranchScopeMeta;
  report?: { branchId: string | null; status: LabReportStatus } | null;
  access?: { branchId: string; profileKey: string | null } | null;
  /** Whether the caller's branch SENT the report (the read-only sender link). */
  senderLinked?: boolean;
  method?: string;
  /** The route is marked AllowSenderLinkRead. */
  allowRead?: boolean;
  params?: Record<string, string>;
  active?: string | null;
}) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === 'allowSenderLinkRead' ? opts.allowRead : opts.meta,
    ),
  } as unknown as Reflector;
  const prisma = {
    labReport: { findFirst: jest.fn().mockResolvedValue(opts.report ?? null) },
    runWithTenant: jest.fn((_t: string, fn: () => Promise<unknown>) => fn()),
  };
  const access = {
    canSee: jest.fn().mockResolvedValue(opts.access ?? null),
    hasSenderLinkTo: jest.fn().mockResolvedValue(opts.senderLinked ?? false),
  };
  const user = {
    tenant_id: 't1',
    person_id: 'p1',
    active_branch_id: opts.active === undefined ? A : opts.active,
    active_profile_key: 'lab_technician',
  };
  const request = {
    user,
    params: opts.params ?? { id: 'r1' },
    method: opts.method ?? 'GET',
  };
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
  return { guard, ctx, user, prisma, access };
}

const META: ReportBranchScopeMeta = { entity: 'report' };

describe('ReportBranchScopeGuard', () => {
  it("re-points the request at the report's own branch and the role held THERE", async () => {
    const { guard, ctx, user } = setup({
      meta: META,
      report: { branchId: B, status: LabReportStatus.SAVED },
      access: { branchId: B, profileKey: 'senior_lab_technician' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // from now on permissions / lookups / audit all use branch B and B's role
    expect(user.active_branch_id).toBe(B);
    expect(user.active_profile_key).toBe('senior_lab_technician');
  });

  it("leaves the caller's own branch untouched (no access lookup at all)", async () => {
    const { guard, ctx, user, access } = setup({
      meta: META,
      report: { branchId: A, status: LabReportStatus.SAVED },
    });
    await guard.canActivate(ctx);
    expect(user.active_branch_id).toBe(A);
    expect(user.active_profile_key).toBe('lab_technician');
    expect(access.canSee).not.toHaveBeenCalled();
  });

  it('does not re-point when the caller has no access to that branch (the lookup then says not found)', async () => {
    const { guard, ctx, user } = setup({
      meta: META,
      report: { branchId: B, status: LabReportStatus.SAVED },
      access: null,
    });
    await guard.canActivate(ctx);
    expect(user.active_branch_id).toBe(A);
  });

  it("asks canSee with the report's status, so a status hidden at that branch stays hidden", async () => {
    const { guard, ctx, access } = setup({
      meta: META,
      report: { branchId: B, status: LabReportStatus.APPROVED },
      access: null,
    });
    await guard.canActivate(ctx);
    expect(access.canSee).toHaveBeenCalledWith(
      't1',
      'p1',
      { branchId: A, profileKey: 'lab_technician' },
      B,
      LabReportStatus.APPROVED,
    );
  });

  it('passes through when the report does not exist, the route has no id, or there is no marker', async () => {
    const missing = setup({ meta: META, report: null });
    await expect(missing.guard.canActivate(missing.ctx)).resolves.toBe(true);
    expect(missing.user.active_branch_id).toBe(A);

    const noId = setup({ meta: META, params: {} });
    await expect(noId.guard.canActivate(noId.ctx)).resolves.toBe(true);
    expect(noId.prisma.labReport.findFirst).not.toHaveBeenCalled();

    const unmarked = setup({ meta: undefined });
    await expect(unmarked.guard.canActivate(unmarked.ctx)).resolves.toBe(true);
    expect(unmarked.prisma.labReport.findFirst).not.toHaveBeenCalled();
  });

  it('uses the route parameter named in the marker', async () => {
    const { guard, ctx, prisma } = setup({
      meta: { entity: 'report', param: 'labReportId' },
      params: { labReportId: 'r9' },
      report: { branchId: A, status: LabReportStatus.SAVED },
    });
    await guard.canActivate(ctx);
    const call = prisma.labReport.findFirst.mock.calls[0] as [
      { where: { id: string; tenantId: string } },
    ];
    expect(call[0].where).toMatchObject({ id: 'r9', tenantId: 't1' });
  });

  it('opens a tenant context for its own lookups (guards run before the tenant interceptor)', async () => {
    const { guard, ctx, prisma } = setup({
      meta: META,
      report: { branchId: A, status: LabReportStatus.SAVED },
    });
    await guard.canActivate(ctx);
    expect(prisma.runWithTenant).toHaveBeenCalledWith(
      't1',
      expect.any(Function),
    );
  });
});

describe('ReportBranchScopeGuard - a branch that only SENT the report', () => {
  const sent = {
    meta: META,
    report: { branchId: B, status: LabReportStatus.SAVED },
    access: null, // no working access at B
    senderLinked: true,
  };

  it('may LOOK at it: GET is re-pointed at the report branch with no role', async () => {
    const { guard, ctx, user, access } = setup({ ...sent, method: 'GET' });
    await guard.canActivate(ctx);
    expect(access.hasSenderLinkTo).toHaveBeenCalledWith(
      't1',
      'p1',
      { branchId: A, profileKey: 'lab_technician' },
      'r1',
    );
    expect(user.active_branch_id).toBe(B);
    expect(user.active_profile_key).toBeNull();
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'is NOT re-pointed for %s, so every write keeps failing at the branch-scoped lookup',
    async (method) => {
      const { guard, ctx, user, access } = setup({ ...sent, method });
      await guard.canActivate(ctx);
      expect(access.hasSenderLinkTo).not.toHaveBeenCalled();
      expect(user.active_branch_id).toBe(A);
    },
  );

  it('a POST route marked AllowSenderLinkRead (print) is allowed', async () => {
    const { guard, ctx, user } = setup({
      ...sent,
      method: 'POST',
      allowRead: true,
    });
    await guard.canActivate(ctx);
    expect(user.active_branch_id).toBe(B);
    expect(user.active_profile_key).toBeNull();
  });

  it('no link, no access: untouched (the lookup then says not found)', async () => {
    const { guard, ctx, user } = setup({ ...sent, senderLinked: false });
    await guard.canActivate(ctx);
    expect(user.active_branch_id).toBe(A);
    expect(user.active_profile_key).toBe('lab_technician');
  });

  it('real access beats the link: judged at the report branch with their role there', async () => {
    const { guard, ctx, user, access } = setup({
      ...sent,
      access: { branchId: B, profileKey: 'lab_supervisor' },
    });
    await guard.canActivate(ctx);
    expect(access.hasSenderLinkTo).not.toHaveBeenCalled();
    expect(user.active_branch_id).toBe(B);
    expect(user.active_profile_key).toBe('lab_supervisor');
  });
});
