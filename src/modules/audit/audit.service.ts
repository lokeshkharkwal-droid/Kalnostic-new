import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditAction, AuditLog, AuditModule, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { QueryAuditDto } from './dto/query-audit.dto';
import { AuditNotFoundException } from './exceptions/audit.exceptions';

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
  ): Promise<PaginatedResult<AuditLog>> {
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

    const data = await this.prisma.auditLog.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.auditLog.count({ where });
    return { data, total, page, limit };
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
