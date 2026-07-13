import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditAction, AuditLog, AuditModule, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { QueryAuditDto } from './dto/query-audit.dto';
import { SiteAdminQueryAuditDto } from './dto/siteadmin-query-audit.dto';
import { AuditNotFoundException } from './exceptions/audit.exceptions';

/**
 * An audit-log row enriched for the SiteAdmin cross-tenant view: the raw row
 * plus the actor's human name/username and the owning business name (the row
 * itself only stores `actorPersonId` + `tenantId`).
 */
export interface SiteAdminAuditLog extends AuditLog {
  actorName: string | null;
  actorUsername: string | null;
  tenantName: string | null;
}

/**
 * An audit-log row enriched for the business (tenant) view: the raw row plus the
 * actor's human name/username (the row itself only stores `actorPersonId`), so
 * the frontend can show a name instead of a UUID.
 */
export interface TenantAuditLog extends AuditLog {
  actorName: string | null;
  actorUsername: string | null;
}

/**
 * Payload for recording a single audit event. Built by the `AuditInterceptor`
 * from route metadata + the request context, or by a caller logging explicitly.
 * `tenantId` and the actor fields come from the authenticated JWT, never from a
 * request body.
 */
export interface AuditRecordInput {
  tenantId: string;
  branchId?: string | null;
  module: AuditModule;
  action?: AuditAction;
  description: string;
  actorPersonId: string;
  actorRoleKey?: string | null;
  actorRoleLabel?: string | null;
  ipAddress?: string | null;
  resourceId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Audit-trail management. Tenant-scoped: every query carries `tenantId`
 * (defence in depth on top of RLS — CLAUDE.md §4.3) and filters soft-deleted
 * rows. Rows are append-only in practice — there are no update/delete methods.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Record an audit event. **Fire-and-forget**: this never throws and never
   * blocks the caller — a failure to write the audit row must not fail the
   * underlying business operation, so errors are caught and logged only.
   *
   * The insert runs through `withTenant` so the RLS tenant GUC is set for the
   * write regardless of the surrounding async-context timing.
   *
   * @param input the event to record (tenant + actor come from the JWT)
   */
  record(input: AuditRecordInput): void {
    void this.prisma
      .withTenant(input.tenantId, (tx) =>
        tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            branchId: input.branchId ?? null,
            module: input.module,
            action: input.action ?? AuditAction.OTHER,
            description: input.description,
            actorPersonId: input.actorPersonId,
            actorRoleKey: input.actorRoleKey ?? null,
            actorRoleLabel: input.actorRoleLabel ?? null,
            ipAddress: input.ipAddress ?? null,
            resourceId: input.resourceId ?? null,
            metadata: input.metadata ?? Prisma.JsonNull,
          },
        }),
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to write audit log (module=${input.module}, actor=${input.actorPersonId}): ${message}`,
        );
      });
  }

  /**
   * List audit logs for a tenant (offset pagination), newest first, with
   * optional filtering by module, action, actor, branch, and date range, plus
   * a free-text `search` over the actor and description.
   * @param tenantId tenant scope
   * @param query validated filters + pagination
   * @returns a paginated result the interceptor reshapes into `meta`
   */
  async findAllForTenant(
    tenantId: string,
    query: QueryAuditDto,
  ): Promise<PaginatedResult<TenantAuditLog>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AuditLogWhereInput = { tenantId, deletedAt: null };
    if (query.module !== undefined) where.module = query.module;
    if (query.action !== undefined) where.action = query.action;
    if (query.actorPersonId !== undefined) {
      where.actorPersonId = query.actorPersonId;
    }
    if (query.branchId !== undefined) where.branchId = query.branchId;
    const search = query.search?.trim();
    if (search) {
      // "User and description" search: match the actor (person id / role label)
      // or the human-readable description, case-insensitively.
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { actorPersonId: { contains: search, mode: 'insensitive' } },
        { actorRoleLabel: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.from !== undefined || query.to !== undefined) {
      where.createdAt = {
        ...(query.from !== undefined ? { gte: new Date(query.from) } : {}),
        ...(query.to !== undefined ? { lte: new Date(query.to) } : {}),
      };
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.auditLog.count({ where });
    const data = await this.enrichActorNames(rows);
    return { data, total, page, limit };
  }

  /**
   * SiteAdmin cross-tenant audit view: list audit logs across **all** businesses
   * (or a single one when `tenantId` is given), newest first, with the same
   * filters as the tenant view plus actor-name / business-name enrichment.
   *
   * Tenant-scoped tables have RLS, so an unscoped read returns zero rows when
   * `RLS_ENABLED=true`. We therefore run each tenant's query inside
   * `runWithTenant` (the SiteAdmin cross-tenant read pattern — see
   * `PrismaService.runWithTenant`). For the all-businesses case we take the top
   * `page*limit` rows per tenant, merge, sort by `createdAt` desc, and slice — so
   * the returned page is the correct global top-N. Actor and business lookups hit
   * the platform-level `persons` / `person_credentials` / `tenants` tables, which
   * have no RLS, so they run outside any tenant context.
   *
   * @param query validated filters + pagination (+ optional `tenantId`)
   * @returns a paginated result the interceptor reshapes into `meta`
   */
  async findAllForSiteAdmin(
    query: SiteAdminQueryAuditDto,
  ): Promise<PaginatedResult<SiteAdminAuditLog>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AuditLogWhereInput = { deletedAt: null };
    if (query.module !== undefined) where.module = query.module;
    if (query.action !== undefined) where.action = query.action;
    if (query.actorPersonId !== undefined) {
      where.actorPersonId = query.actorPersonId;
    }
    if (query.branchId !== undefined) where.branchId = query.branchId;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { actorPersonId: { contains: search, mode: 'insensitive' } },
        { actorRoleLabel: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.from !== undefined || query.to !== undefined) {
      where.createdAt = {
        ...(query.from !== undefined ? { gte: new Date(query.from) } : {}),
        ...(query.to !== undefined ? { lte: new Date(query.to) } : {}),
      };
    }

    // Resolve the tenants in scope (platform-level `tenants` table, no RLS) so we
    // can both drive the per-tenant queries and map tenant id → business name.
    const tenants = await this.prisma.tenant.findMany({
      where: {
        deletedAt: null,
        ...(query.tenantId !== undefined ? { id: query.tenantId } : {}),
      },
      select: { id: true, name: true },
    });
    const tenantNameById = new Map(tenants.map((t) => [t.id, t.name]));

    let rows: AuditLog[];
    let total = 0;

    if (query.tenantId !== undefined) {
      // Single business — fast, exact offset pagination.
      const scopedWhere: Prisma.AuditLogWhereInput = {
        ...where,
        tenantId: query.tenantId,
      };
      [rows, total] = await this.prisma.runWithTenant(query.tenantId, () =>
        Promise.all([
          this.prisma.auditLog.findMany({
            where: scopedWhere,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' },
          }),
          this.prisma.auditLog.count({ where: scopedWhere }),
        ]),
      );
    } else {
      // All businesses — gather the top `page*limit` per tenant, then merge.
      const take = page * limit;
      const collected: AuditLog[] = [];
      for (const tenant of tenants) {
        const scopedWhere: Prisma.AuditLogWhereInput = {
          ...where,
          tenantId: tenant.id,
        };
        const [tenantRows, tenantCount] = await this.prisma.runWithTenant(
          tenant.id,
          () =>
            Promise.all([
              this.prisma.auditLog.findMany({
                where: scopedWhere,
                take,
                orderBy: { createdAt: 'desc' },
              }),
              this.prisma.auditLog.count({ where: scopedWhere }),
            ]),
        );
        collected.push(...tenantRows);
        total += tenantCount;
      }
      collected.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      rows = collected.slice((page - 1) * limit, page * limit);
    }

    const data = await this.enrichForSiteAdmin(rows, tenantNameById);
    return { data, total, page, limit };
  }

  /**
   * Attach the actor's name/username and the business name to audit rows for the
   * SiteAdmin view. `persons` / `person_credentials` are platform-level (no RLS),
   * so these lookups run without a tenant context.
   * @param rows the page of audit rows to enrich
   * @param tenantNameById tenant id → business name (already resolved by caller)
   */
  private async enrichForSiteAdmin(
    rows: AuditLog[],
    tenantNameById: Map<string, string>,
  ): Promise<SiteAdminAuditLog[]> {
    const withActors = await this.enrichActorNames(rows);
    return withActors.map((r) => ({
      ...r,
      tenantName: tenantNameById.get(r.tenantId) ?? null,
    }));
  }

  /**
   * Attach each actor's human name + system username to audit rows. `persons` /
   * `person_credentials` are platform-level (no RLS), so these lookups run
   * without a tenant context. Shared by the tenant list (`findAllForTenant`) and
   * the SiteAdmin view (`enrichForSiteAdmin`).
   * @param rows the page of audit rows to enrich
   */
  private async enrichActorNames(rows: AuditLog[]): Promise<TenantAuditLog[]> {
    const personIds = [...new Set(rows.map((r) => r.actorPersonId))];
    if (personIds.length === 0) {
      return rows.map((r) => ({ ...r, actorName: null, actorUsername: null }));
    }

    const [persons, credentials] = await Promise.all([
      this.prisma.person.findMany({
        where: { id: { in: personIds } },
        select: { id: true, firstName: true, middleName: true, lastName: true },
      }),
      this.prisma.personCredentials.findMany({
        where: { personId: { in: personIds } },
        select: { personId: true, systemUsername: true },
      }),
    ]);

    const nameById = new Map(
      persons.map((p) => [
        p.id,
        [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' '),
      ]),
    );
    const usernameById = new Map(
      credentials.map((c) => [c.personId, c.systemUsername]),
    );

    return rows.map((r) => ({
      ...r,
      actorName: nameById.get(r.actorPersonId) ?? null,
      actorUsername: usernameById.get(r.actorPersonId) ?? null,
    }));
  }

  /**
   * Fetch one audit log scoped to its tenant.
   * @param id audit log id
   * @param tenantId tenant scope
   * @throws AuditNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<AuditLog> {
    const log = await this.prisma.auditLog.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!log) {
      throw new AuditNotFoundException(id);
    }
    return log;
  }

  /**
   * Purge audit logs older than the configured retention window
   * (`AUDIT_RETENTION_DAYS`, default 90 days). Runs automatically once a day.
   *
   * This is a **hard delete** — the deliberate, documented exception to the
   * project's soft-delete convention (CLAUDE.md §4.7). Audit logs are an
   * append-only, ever-growing trail, so a retention policy must reclaim
   * storage; a soft delete would only hide the rows while keeping them forever.
   *
   * Cross-tenant by design (like SiteAdmin tooling, §4.7): the cron has no
   * request/tenant context, and `audit_logs` has FORCE ROW LEVEL SECURITY, so a
   * single unscoped `deleteMany` would match zero rows when `RLS_ENABLED=true`.
   * Instead it enumerates every tenant (the platform-level `tenants` table has
   * no RLS) and deletes per tenant inside `withTenant`, which sets the RLS GUC
   * for each delete. `tenantId` stays in the `where` for defence in depth.
   *
   * @returns the total number of rows purged across all tenants
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeExpired(): Promise<number> {
    const days = this.config.get<number>('audit.retentionDays', 90);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });

    let purged = 0;
    for (const { id: tenantId } of tenants) {
      const { count } = await this.prisma.withTenant(tenantId, (tx) =>
        tx.auditLog.deleteMany({
          where: { tenantId, createdAt: { lt: cutoff } },
        }),
      );
      purged += count;
    }

    this.logger.log(
      `Audit retention purge: removed ${purged} row(s) older than ${days}d across ${tenants.length} tenant(s)`,
    );
    return purged;
  }
}
