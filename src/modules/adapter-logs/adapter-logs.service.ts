import { Injectable, Logger } from '@nestjs/common';
import { AdapterAction, AdapterLog, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { QueryAdapterLogsDto } from './dto/query-adapter-logs.dto';
import { SiteAdminQueryAdapterLogsDto } from './dto/siteadmin-query-adapter-logs.dto';
import { AdapterLogNotFoundException } from './exceptions/adapter-logs.exceptions';

/** Profile key for a tenant-level business administrator (sees all branches). */
const BUSINESS_ADMIN_PROFILE = 'business_admin';

/**
 * An adapter-log row enriched for the SiteAdmin cross-tenant view: the raw row
 * plus the owning business name so the frontend can show a name instead of a
 * tenant UUID.
 */
export interface SiteAdminAdapterLogView extends AdapterLog {
  tenantName: string | null;
}

/**
 * Payload for recording a single adapter-log event. Built by the EMI adapter
 * layer (`/emi/orders`, `/emi/submitResult`) from the resolved adapter + request
 * context. `tenantId` (and `branchId`) come from the authenticating adapter,
 * never a request body.
 */
export interface AdapterLogRecordInput {
  tenantId: string;
  branchId?: string | null;
  token?: string | null;
  action: AdapterAction;
  status?: string | null;
  statusCode?: number | null;
  sourceIpAddress?: string | null;
  request?: string | null;
  response?: string | null;
}

/**
 * Adapter-log reads. Tenant-scoped: every query carries `tenantId` (defence in
 * depth on top of RLS — CLAUDE.md §4.3) and filters soft-deleted rows. Rows are
 * append-only in practice (written by the EMI adapter layer), so there are no
 * create/update/delete methods here.
 */
@Injectable()
export class AdapterLogsService {
  private readonly logger = new Logger(AdapterLogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an adapter-log event. **Fire-and-forget**: this never throws and
   * never blocks the caller — a failure to write the log row must not break the
   * underlying EMI transaction, so errors are caught and logged only.
   *
   * `adapter_logs` is tenant-scoped with FORCE RLS, so the insert runs through
   * `withTenant` to set the tenant GUC regardless of the surrounding async
   * context (the EMI routes are `@Public()` and carry no JWT tenant context).
   *
   * @param input the event to record (tenant + branch come from the adapter)
   */
  record(input: AdapterLogRecordInput): void {
    void this.prisma
      .withTenant(input.tenantId, (tx) =>
        tx.adapterLog.create({
          data: {
            tenantId: input.tenantId,
            branchId: input.branchId ?? null,
            token: input.token ?? null,
            action: input.action,
            status: input.status ?? null,
            statusCode: input.statusCode ?? null,
            sourceIpAddress: input.sourceIpAddress ?? null,
            request: input.request ?? null,
            response: input.response ?? null,
          },
        }),
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to write adapter log (action=${input.action}, tenant=${input.tenantId}): ${message}`,
        );
      });
  }

  /**
   * List adapter logs for the caller's context (offset pagination), newest
   * first. Scope depends on the active profile (CLAUDE.md §4.7):
   *  - `business_admin` (tenant-level) sees every branch in its tenant, and may
   *    narrow to one branch via `query.branchId`.
   *  - any other (branch-scoped) profile is **locked** to its own
   *    `profile.branchId`; a client-supplied `branchId` is ignored.
   *
   * @param tenantId tenant scope (from the JWT)
   * @param profile the active profile/branch context (from the JWT)
   * @param query validated filters + pagination
   * @returns a paginated result the interceptor reshapes into `meta`
   */
  async findAllForContext(
    tenantId: string,
    profile: ActiveProfile,
    query: QueryAdapterLogsDto,
  ): Promise<PaginatedResult<AdapterLog>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AdapterLogWhereInput = { tenantId, deletedAt: null };

    if (profile.profileKey === BUSINESS_ADMIN_PROFILE) {
      // Tenant-level admin: all branches, or narrow to one when asked.
      if (query.branchId !== undefined) where.branchId = query.branchId;
    } else {
      // Branch-scoped profile: locked to its own branch — never trust the body.
      where.branchId = profile.branchId;
    }

    this.applyFilters(where, query);

    const [rows, total] = await Promise.all([
      this.prisma.adapterLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.adapterLog.count({ where }),
    ]);
    return { data: rows, total, page, limit };
  }

  /**
   * SiteAdmin cross-tenant adapter-log view: list logs newest first across
   * **all** businesses (or a single one when `tenantId` is given), each enriched
   * with the owning business name.
   *
   * Tenant-scoped tables have RLS, so an unscoped read returns zero rows when
   * `RLS_ENABLED=true`. We therefore run each tenant's query inside
   * `runWithTenant` (the SiteAdmin cross-tenant read pattern — see
   * `PrismaService.runWithTenant`). For the all-businesses view we take the top
   * `page*limit` rows per tenant, merge, sort by `createdAt` desc, and slice —
   * so the returned page is the correct global top-N.
   *
   * @param query validated filters + pagination (+ optional `tenantId`)
   * @returns a paginated result the interceptor reshapes into `meta`
   */
  async findAllForSiteAdmin(
    query: SiteAdminQueryAdapterLogsDto,
  ): Promise<PaginatedResult<SiteAdminAdapterLogView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AdapterLogWhereInput = { deletedAt: null };
    if (query.branchId !== undefined) where.branchId = query.branchId;
    this.applyFilters(where, query);

    // Resolve tenants in scope (platform-level `tenants` table, no RLS) so we can
    // both drive the per-tenant queries and map tenant id → business name.
    const tenants = await this.prisma.tenant.findMany({
      where: {
        deletedAt: null,
        ...(query.tenantId !== undefined ? { id: query.tenantId } : {}),
      },
      select: { id: true, name: true },
    });
    const tenantNameById = new Map(tenants.map((t) => [t.id, t.name]));

    // Single business — fast, exact offset pagination on that tenant alone.
    if (query.tenantId !== undefined) {
      const scopedWhere: Prisma.AdapterLogWhereInput = {
        ...where,
        tenantId: query.tenantId,
      };
      const [rows, total] = await this.prisma.runWithTenant(
        query.tenantId,
        () =>
          Promise.all([
            this.prisma.adapterLog.findMany({
              where: scopedWhere,
              skip: (page - 1) * limit,
              take: limit,
              orderBy: { createdAt: 'desc' },
            }),
            this.prisma.adapterLog.count({ where: scopedWhere }),
          ]),
      );
      return {
        data: rows.map((r) => this.withTenantName(r, tenantNameById)),
        total,
        page,
        limit,
      };
    }

    // All businesses — gather the top `page*limit` rows per tenant, then merge,
    // sort, and slice the page.
    const take = page * limit;
    let total = 0;
    const collected: AdapterLog[] = [];
    for (const tenant of tenants) {
      const scopedWhere: Prisma.AdapterLogWhereInput = {
        ...where,
        tenantId: tenant.id,
      };
      const [rows, count] = await this.prisma.runWithTenant(tenant.id, () =>
        Promise.all([
          this.prisma.adapterLog.findMany({
            where: scopedWhere,
            take,
            orderBy: { createdAt: 'desc' },
          }),
          this.prisma.adapterLog.count({ where: scopedWhere }),
        ]),
      );
      collected.push(...rows);
      total += count;
    }

    collected.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const pageRows = collected.slice((page - 1) * limit, page * limit);
    return {
      data: pageRows.map((r) => this.withTenantName(r, tenantNameById)),
      total,
      page,
      limit,
    };
  }

  /**
   * Fetch one adapter log scoped to its tenant.
   * @param id adapter log id
   * @param tenantId tenant scope
   * @throws AdapterLogNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<AdapterLog> {
    const log = await this.prisma.adapterLog.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!log) {
      throw new AdapterLogNotFoundException(id);
    }
    return log;
  }

  /**
   * Apply the shared optional filters (action / status / date range / free-text
   * search) onto a `where` clause, mutating it in place.
   * @param where the Prisma filter to extend
   * @param query the validated query DTO
   */
  private applyFilters(
    where: Prisma.AdapterLogWhereInput,
    query: QueryAdapterLogsDto,
  ): void {
    if (query.action !== undefined) where.action = query.action;
    if (query.status !== undefined) where.status = query.status;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { token: { contains: search, mode: 'insensitive' } },
        { status: { contains: search, mode: 'insensitive' } },
        { sourceIpAddress: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.from !== undefined || query.to !== undefined) {
      where.createdAt = {
        ...(query.from !== undefined ? { gte: new Date(query.from) } : {}),
        ...(query.to !== undefined ? { lte: new Date(query.to) } : {}),
      };
    }
  }

  /**
   * Tag a raw adapter-log row with its owning business name for the SiteAdmin view.
   * @param row the raw adapter-log row
   * @param tenantNameById tenant id → business name (already resolved by caller)
   */
  private withTenantName(
    row: AdapterLog,
    tenantNameById: Map<string, string>,
  ): SiteAdminAdapterLogView {
    return { ...row, tenantName: tenantNameById.get(row.tenantId) ?? null };
  }
}
