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

/** Metadata key: a non-GET route that only READS (print) and may serve a sender link. */
export const ALLOW_SENDER_LINK_READ_KEY = 'allowSenderLinkRead';

/**
 * Marks a POST route that only reads or renders (for example printing a report),
 * so a branch that merely SENT the report may call it. Every other non-GET route
 * is refused to such a caller.
 */
export const AllowSenderLinkRead = () =>
  SetMetadata(ALLOW_SENDER_LINK_READ_KEY, true);

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
 * A branch that only SENT the report (its sample was accepted by the receiver)
 * may look at it: for GET requests, and for routes marked
 * {@link AllowSenderLinkRead}, the request is re-pointed at the report's branch
 * with NO role, so every permission-annotated route refuses it and only the
 * open reads answer. Every other verb is left untouched.
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

    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      params?: Record<string, string>;
      method?: string;
    }>();
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
    if (access) {
      user.active_branch_id = access.branchId;
      user.active_profile_key = access.profileKey;
      return true;
    }

    // No working access at the report's branch. A branch that SENT the report
    // may still look at it — reads only, with no role at the other branch.
    if (
      meta.entity === 'report' &&
      this.isReadRequest(request.method, context)
    ) {
      const linked = await this.access.hasSenderLinkTo(
        user.tenant_id,
        user.person_id,
        {
          branchId: user.active_branch_id,
          profileKey: user.active_profile_key,
        },
        id,
      );
      if (linked) {
        user.active_branch_id = target.branchId;
        user.active_profile_key = null; // no permissions at that branch
      }
    }
    // Otherwise untouched: the branch-scoped lookup will say not found.
    return true;
  }

  /** GET / HEAD, or a route explicitly marked as read-only. */
  private isReadRequest(
    method: string | undefined,
    context: ExecutionContext,
  ): boolean {
    const verb = (method ?? '').toUpperCase();
    if (verb === 'GET' || verb === 'HEAD') return true;
    return !!this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_SENDER_LINK_READ_KEY,
      [context.getHandler(), context.getClass()],
    );
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
      // A worklist row follows its REPORT: the row's own branch is only where it
      // was raised, and goes stale once the report is re-homed.
      const include = {
        select: {
          labReport: { select: { branchId: true, status: true } },
        },
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
        ? { branchId: row.labReport.branchId, status: row.labReport.status }
        : null;
    };
    // Guards run before the tenant interceptor: open the RLS context if absent.
    return tenantContext.getStore()?.tenantId
      ? run()
      : this.prisma.runWithTenant(tenantId, run);
  }
}
