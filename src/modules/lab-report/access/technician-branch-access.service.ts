import { Injectable } from '@nestjs/common';
import {
  LabReportStatus,
  StaffStatus,
  TransferKind,
  TransferStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { tenantContext } from '../../../prisma/tenant-context';
import { UsersService } from '../../users/users.service';
import { ADMIN_BYPASS_ROLES } from '../../permissions/services/permission-check.service';
import {
  ActiveBranchRequiredException,
  BranchNotAccessibleException,
} from '../exceptions/lab-report.exceptions';
import {
  isStatusVisible,
  senderLinkWhere,
  visibleStatusesFor,
  type BranchRule,
  type VisibleStatuses,
  type WorklistBranchScope,
} from './worklist-branch-scope';

/** The Technician module's key in `enabledModules` / `branch_modules`. */
export const TECHNICIAN_MODULE_KEY = 'lab_operations';

/** The caller's active profile context (from the JWT). */
export interface ActiveContext {
  branchId: string | null;
  profileKey: string | null;
}

/** One branch the caller is authorised to reach through the Technician module. */
export interface BranchAccess {
  branchId: string;
  branchName: string;
  /** The caller's role at THIS branch (not the active profile's). */
  profileKey: string | null;
  /** True for the caller's own (active) branch. */
  isActiveBranch: boolean;
  /** Admin roles bypass per-permission checks. */
  isAdmin: boolean;
  /** The caller's effective permission keys at this branch only. */
  permissions: ReadonlySet<string>;
  /** Report statuses the caller may see at this branch. */
  visibleStatuses: VisibleStatuses;
}

/**
 * Works out which branches' reports a technician may reach, and what they may do
 * at each — keeping the three layers separate:
 *
 *  1. **Branch access** — an active profile at the branch (profile, branch and
 *     per-branch status all active).
 *  2. **Technician-module access** — that profile's `enabledModules` includes the
 *     Technician module AND the module is enabled for the branch.
 *  3. **Report permissions** — the person's effective permissions *at that
 *     branch* (user override ?? branch-role override ?? role baseline). They are
 *     never merged across branches: a report is judged only by its own branch.
 *
 * Layers 1+2 decide which branches' reports can be seen; layer 3 decides which
 * stages are visible and what actions are allowed there. Everything is read from
 * the database on each call, so revoking access takes effect on the next request
 * (the login token's profile list is deliberately not used).
 *
 * The caller's own active branch is always included and fully visible, so
 * own-branch behaviour is exactly what it was before cross-branch access existed.
 */
@Injectable()
export class TechnicianBranchAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Run `work` with the RLS tenant context set. Guards execute before the tenant
   * interceptor, so when there is no ambient context this opens one — the same
   * pattern `PermissionCheckService` uses.
   */
  private withTenantContext<T>(
    tenantId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return tenantContext.getStore()?.tenantId
      ? work()
      : this.prisma.runWithTenant(tenantId, work);
  }

  /**
   * Every branch the caller may reach, own branch first. See the class comment.
   * @param active the caller's active profile (own branch + role)
   */
  resolve(
    tenantId: string,
    personId: string,
    active: ActiveContext,
  ): Promise<BranchAccess[]> {
    return this.withTenantContext(tenantId, async () => {
      const profiles = await this.prisma.userBranchProfile.findMany({
        where: {
          tenantId,
          personId,
          deletedAt: null,
          isActive: true,
          branchStatus: StaffStatus.ACTIVE,
          branchId: { not: null },
          enabledModules: { has: TECHNICIAN_MODULE_KEY },
        },
        select: { branchId: true, authRole: { select: { key: true } } },
      });
      const candidateIds = [
        ...new Set(
          profiles.map((p) => p.branchId).filter((v): v is string => !!v),
        ),
      ];
      if (active.branchId && !candidateIds.includes(active.branchId)) {
        candidateIds.push(active.branchId);
      }
      if (candidateIds.length === 0) return [];

      const [branches, enabledModules] = await Promise.all([
        this.prisma.branch.findMany({
          where: {
            id: { in: candidateIds },
            tenantId,
            deletedAt: null,
            status: 'ACTIVE',
          },
          select: { id: true, name: true },
        }),
        this.prisma.branchModule.findMany({
          where: {
            tenantId,
            branchId: { in: candidateIds },
            moduleKey: TECHNICIAN_MODULE_KEY,
            isEnabled: true,
            deletedAt: null,
          },
          select: { branchId: true },
        }),
      ]);
      const nameById = new Map(branches.map((b) => [b.id, b.name]));
      const moduleOn = new Set(enabledModules.map((m) => m.branchId));
      const roleByBranch = new Map(
        profiles.map((p) => [p.branchId as string, p.authRole?.key ?? null]),
      );

      const out: BranchAccess[] = [];
      for (const branchId of candidateIds) {
        const isActiveBranch = branchId === active.branchId;
        // Own branch: always included (unchanged behaviour). Others need an
        // active branch AND the Technician module enabled for it.
        if (!isActiveBranch) {
          if (!nameById.has(branchId) || !moduleOn.has(branchId)) continue;
        }
        const profileKey = isActiveBranch
          ? (active.profileKey ?? roleByBranch.get(branchId) ?? null)
          : (roleByBranch.get(branchId) ?? null);
        const isAdmin = !!profileKey && ADMIN_BYPASS_ROLES.has(profileKey);
        const permissions = await this.usersService.getEffectivePermissionKeys(
          tenantId,
          personId,
          branchId,
        );
        const visibleStatuses: VisibleStatuses =
          isActiveBranch || isAdmin ? 'ALL' : visibleStatusesFor(permissions);
        out.push({
          branchId,
          branchName: nameById.get(branchId) ?? '',
          profileKey,
          isActiveBranch,
          isAdmin,
          permissions,
          visibleStatuses,
        });
      }
      // Own branch first, then by name — a stable order for the dropdown.
      return out.sort((a, b) =>
        a.isActiveBranch === b.isActiveBranch
          ? a.branchName.localeCompare(b.branchName)
          : a.isActiveBranch
            ? -1
            : 1,
      );
    });
  }

  /**
   * Resolve a worklist request's branch scope.
   *  - omitted `requested` → the caller's own branch only (the default);
   *  - `'all'` → every authorised branch (own branch + the cross-branch ones),
   *    never the whole tenant;
   *  - a branch id → that branch only, and it must be authorised.
   * @param requiredKey when set (the five special worklists), a cross-branch
   *   branch is included only if the caller holds this permission THERE.
   * @throws ActiveBranchRequiredException when no branch can be determined
   * @throws BranchNotAccessibleException for a branch the caller may not reach
   */
  async resolveScope(
    tenantId: string,
    personId: string,
    active: ActiveContext,
    requested: string | undefined,
    requiredKey?: string,
  ): Promise<WorklistBranchScope> {
    if (!requested) {
      if (!active.branchId) throw new ActiveBranchRequiredException();
      const linked = await this.branchesWithSenderLinks(tenantId, [
        active.branchId,
      ]);
      return {
        rules: [
          {
            branchId: active.branchId,
            statuses: 'ALL',
            senderLinked: linked.has(active.branchId),
          },
        ],
      };
    }
    const access = await this.resolve(tenantId, personId, active);
    const usable = (a: BranchAccess): boolean =>
      !requiredKey ||
      a.isActiveBranch ||
      a.isAdmin ||
      a.permissions.has(requiredKey);
    // The sender link only applies to the main worklist: the special tabs list
    // work items a branch can act on, so they stay with the branch holding them.
    const linked = requiredKey
      ? new Set<string>()
      : await this.branchesWithSenderLinks(
          tenantId,
          access.map((a) => a.branchId),
        );
    const toRule = (a: BranchAccess): BranchRule => ({
      branchId: a.branchId,
      statuses: a.visibleStatuses,
      senderLinked: linked.has(a.branchId),
    });
    if (requested.toLowerCase() === 'all') {
      const rules = access.filter(usable).map(toRule);
      if (rules.length === 0) throw new ActiveBranchRequiredException();
      return { rules };
    }
    const match = access.find((a) => a.branchId === requested);
    if (!match || !usable(match)) {
      throw new BranchNotAccessibleException(requested);
    }
    return { rules: [toRule(match)] };
  }

  /**
   * Which of these branches have sent samples that another branch accepted — a
   * cheap existence check so only those branches pay for the sender-link filter.
   */
  private branchesWithSenderLinks(
    tenantId: string,
    branchIds: string[],
  ): Promise<Set<string>> {
    return this.withTenantContext(tenantId, async () => {
      const rows = await this.prisma.sampleTransfer.findMany({
        where: {
          tenantId,
          kind: TransferKind.INTERNAL,
          transferStatus: TransferStatus.ACCEPTED,
          branchId: { in: branchIds },
          deletedAt: null,
        },
        distinct: ['branchId'],
        select: { branchId: true },
      });
      return new Set(
        rows.map((r) => r.branchId).filter((b): b is string => !!b),
      );
    });
  }

  /**
   * Whether the caller may VIEW this report only because a branch of theirs sent
   * it: the caller's own branch (and any branch they are authorised for) sent a
   * sample for it that the receiver accepted, and the report is in a status that
   * branch may see. It grants no permissions at all — the guard re-points the
   * request at the report's branch without a role, for reads only.
   */
  async hasSenderLinkTo(
    tenantId: string,
    personId: string,
    active: ActiveContext,
    reportId: string,
  ): Promise<boolean> {
    const access = await this.resolve(tenantId, personId, active);
    return this.withTenantContext(tenantId, async () => {
      for (const a of access) {
        const row = await this.prisma.labReport.findFirst({
          where: {
            id: reportId,
            tenantId,
            deletedAt: null,
            ...senderLinkWhere(a.branchId),
            ...(a.visibleStatuses === 'ALL'
              ? {}
              : { status: { in: [...a.visibleStatuses] } }),
          },
          select: { id: true },
        });
        if (row) return true;
      }
      return false;
    });
  }

  /**
   * The caller's access at `branchId` when they may see a report in `status`
   * there; otherwise null. Used to decide whether a cross-branch report can be
   * opened.
   */
  async canSee(
    tenantId: string,
    personId: string,
    active: ActiveContext,
    branchId: string,
    status: LabReportStatus,
  ): Promise<BranchAccess | null> {
    const access = await this.resolve(tenantId, personId, active);
    const match = access.find((a) => a.branchId === branchId);
    if (!match || !isStatusVisible(match.visibleStatuses, status)) return null;
    return match;
  }
}
