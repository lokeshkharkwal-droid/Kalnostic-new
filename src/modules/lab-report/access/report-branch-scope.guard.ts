import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LabReportStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { tenantContext } from '../../../prisma/tenant-context';
import type { JwtPayload } from '../../auth/types/jwt-payload.type';
import { TechnicianBranchAccessService } from './technician-branch-access.service';

/** What kind of record the route's id parameter identifies. */
export type ReportBranchEntity =
  | 'report'
  | 'criticalAlert'
  | 'reRunRequest'
  | 'outOfRangeFlag'
  | 'deltaCheck'
  | 'scheduledTest';

export interface ReportBranchScopeMeta {
  entity: ReportBranchEntity;
  /** Route parameter holding the id (default `id`). */
  param?: string;
}

/** Metadata key read by {@link ReportBranchScopeGuard}. */
export const REPORT_BRANCH_SCOPE_KEY = 'reportBranchScope';

/**
 * Marks a controller whose routes act on ONE report (or one worklist entry that
 * belongs to a report) so the request is evaluated at the report's own branch.
 */
export const ReportBranchScope = (meta: ReportBranchScopeMeta) =>
  SetMetadata(REPORT_BRANCH_SCOPE_KEY, meta);

/**
 * Evaluates a report-scoped request at the **report's own branch**.
 *
 * Every controller reads the caller's branch and role from the request's JWT
 * payload (`active_branch_id` / `active_profile_key`), and `PermissionGuard`
 * evaluates `@RequirePermission` against the same fields. When the report
 * belongs to ANOTHER branch the caller is authorised for (branch access +
 * Technician-module access, and the report's status is visible there), this
 * guard re-points those two fields at that branch and the caller's role there.
 * From then on the existing handlers and `PermissionGuard` work unchanged — but
 * every check, lookup, audit entry and permission is that branch's, never the
 * caller's own branch's.
 *
 * Anything else is left untouched, so the existing branch-scoped lookup answers
 * "not found" exactly as before: a branch the caller has no access to, a branch
 * without Technician-module access, or a status the caller can't see there. Must
 * be listed BEFORE `PermissionGuard`.
 */
@Injectable()
export class ReportBranchScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly access: TechnicianBranchAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<
      ReportBranchScopeMeta | undefined
    >(REPORT_BRANCH_SCOPE_KEY, [context.getHandler(), context.getClass()]);
    if (!meta) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: JwtPayload; params?: Record<string, string> }>();
    const user = request.user;
    if (!user?.active_branch_id) return true;
    const id = request.params?.[meta.param ?? 'id'];
    if (!id) return true;

    const target = await this.lookup(user.tenant_id, meta.entity, id);
    if (!target?.branchId || target.branchId === user.active_branch_id) {
      return true; // not found, or the caller's own branch: unchanged
    }

    const access = await this.access.canSee(
      user.tenant_id,
      user.person_id,
      {
        branchId: user.active_branch_id,
        profileKey: user.active_profile_key,
      },
      target.branchId,
      target.status,
    );
    if (!access) return true; // no access there: the lookup will say not found

    user.active_branch_id = access.branchId;
    user.active_profile_key = access.profileKey;
    return true;
  }

  private lookup(
    tenantId: string,
    entity: ReportBranchEntity,
    id: string,
  ): Promise<{ branchId: string | null; status: LabReportStatus } | null> {
    const run = async () => {
      const where = { id, tenantId, deletedAt: null };
      if (entity === 'report') {
        return this.prisma.labReport.findFirst({
          where,
          select: { branchId: true, status: true },
        });
      }
      const include = {
        select: { branchId: true, labReport: { select: { status: true } } },
      };
      const row =
        entity === 'criticalAlert'
          ? await this.prisma.criticalAlert.findFirst({ where, ...include })
          : entity === 'reRunRequest'
            ? await this.prisma.reRunRequest.findFirst({ where, ...include })
            : entity === 'outOfRangeFlag'
              ? await this.prisma.outOfRangeFlag.findFirst({
                  where,
                  ...include,
                })
              : entity === 'deltaCheck'
                ? await this.prisma.deltaCheck.findFirst({ where, ...include })
                : await this.prisma.scheduledTest.findFirst({
                    where,
                    ...include,
                  });
      return row
        ? { branchId: row.branchId, status: row.labReport.status }
        : null;
    };
    // Guards run before the tenant interceptor: open the RLS context if absent.
    return tenantContext.getStore()?.tenantId
      ? run()
      : this.prisma.runWithTenant(tenantId, run);
  }
}
