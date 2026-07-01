import { Injectable } from '@nestjs/common';
import { Prisma, Template, TemplateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { ConsentConfigDto } from './dto/blocks/consent-config.dto';
import { WhatsappConfigDto } from './dto/blocks/whatsapp-config.dto';
import { ReportConfigDto } from './dto/blocks/report-config.dto';
import {
  TemplateNameConflictException,
  TemplateNotFoundException,
} from './exceptions/template.exceptions';

/** The DTO fields that determine a template's type-specific `config` JSON. */
interface ConfigSource {
  subject?: string;
  consent?: ConsentConfigDto;
  whatsapp?: WhatsappConfigDto;
  report?: ReportConfigDto;
}

/**
 * Template management. Tenant-scoped + branch-level (CLAUDE.md §4.6/§4.7):
 * `branchId` is NULL for tenant-level templates (business-admin) and the active
 * branch for branch-level templates (branch-admin). The scope is decided by the
 * caller (from `@CurrentProfile()`) and passed in as `scopeBranchId`; the two
 * scopes are independent (a query with `branchId: null` matches tenant-level
 * rows only). Every query carries `tenantId` (defence in depth on top of RLS)
 * and filters soft-deleted rows.
 *
 * Type-specific and shared optional blocks are stored as DTO-validated JSON
 * (like Schedule.shifts), assembled from the DTO via `buildConfig`.
 */
@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Create a template in the caller's scope. The `code` is system-generated and
   * immutable: `{INITIALS}-Tpl-{n}`, where INITIALS derive from the tenant name
   * and `n` is a 0-based per-tenant sequence taken by atomically incrementing
   * `Tenant.templateCounter` in the same transaction (so concurrent creates
   * never collide).
   * @param tenantId owning tenant (from JWT)
   * @param scopeBranchId active branch (branch-admin) or null (business-admin)
   * @param dto validated template payload (no `code`/`tenantId`/`branchId`)
   * @param actorId person id of the creator (optional audit trail)
   * @returns the created template
   * @throws BranchNotFoundException if a non-null scope branch isn't in the tenant
   * @throws TemplateNameConflictException if the name is already used by an
   *   active template of the same type in this scope
   */
  async create(
    tenantId: string,
    scopeBranchId: string | null,
    dto: CreateTemplateDto,
    actorId?: string,
  ): Promise<Template> {
    // Validate the scope branch belongs to the caller's tenant (§4.7) before the
    // RLS transaction. Tenant-level (null) needs no branch check.
    if (scopeBranchId !== null) {
      await this.branchService.findById(scopeBranchId, tenantId);
    }
    const config = this.buildConfig(dto.type, dto);
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { templateCounter: { increment: 1 } },
          select: { templateCounter: true, name: true },
        });
        // 0-based sequence: post-increment counter, so subtract 1 for this row.
        const code = `${this.buildInitials(tenant.name)}-Tpl-${tenant.templateCounter - 1}`;

        return tx.template.create({
          data: {
            tenantId,
            branchId: scopeBranchId,
            type: dto.type,
            name: dto.name,
            code,
            triggerEvent: dto.triggerEvent,
            version: dto.version ?? 'v1.0',
            isActive: dto.isActive ?? true,
            body: dto.body ?? '',
            config,
            headerBlock: dto.header ? this.asJson(dto.header) : undefined,
            footerBlock: dto.footerBlock
              ? this.asJson(dto.footerBlock)
              : undefined,
            attachment: dto.attachment
              ? this.asJson(dto.attachment)
              : undefined,
            createdBy: actorId ?? null,
            updatedBy: actorId ?? null,
          },
        });
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name);
      throw e;
    }
  }

  /**
   * Fetch one active template scoped to its tenant + scope branch.
   * @param id template id
   * @param tenantId tenant scope
   * @param scopeBranchId active branch, or null for tenant-level
   * @throws TemplateNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
    scopeBranchId: string | null,
  ): Promise<Template> {
    const template = await this.prisma.template.findFirst({
      where: { id, tenantId, branchId: scopeBranchId, deletedAt: null },
    });
    if (!template) {
      throw new TemplateNotFoundException(id);
    }
    return template;
  }

  /**
   * List active templates in the caller's scope (offset pagination).
   * @param tenantId tenant scope
   * @param scopeBranchId active branch, or null for tenant-level
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional `type` tab filter, case-insensitive name `search`,
   *   and `isActive` status filter
   */
  async findAll(
    tenantId: string,
    scopeBranchId: string | null,
    page = 1,
    limit = 20,
    filters: { type?: TemplateType; search?: string; isActive?: boolean } = {},
  ): Promise<PaginatedResult<Template>> {
    const where: Prisma.TemplateWhereInput = {
      tenantId,
      branchId: scopeBranchId,
      deletedAt: null,
    };
    if (filters.type) {
      where.type = filters.type;
    }
    const search = filters.search?.trim();
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    // Sequential (not array-`$transaction`) so each call flows through the RLS
    // extension and carries the tenant GUC when RLS is enabled.
    const data = await this.prisma.template.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.template.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Partial, dropdown-optimised listing: returns only `{ id, name }` per row,
   * scoped to the caller's tenant + branch (from the JWT, never the query), with
   * an optional `type` filter and offset pagination. Ordered by `name` ascending
   * for predictable dropdowns.
   * @param tenantId tenant scope
   * @param scopeBranchId active branch, or null for tenant-level
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param type optional template-type filter
   */
  async lookup(
    tenantId: string,
    scopeBranchId: string | null,
    page = 1,
    limit = 20,
    type?: TemplateType,
  ): Promise<PaginatedResult<{ id: string; name: string }>> {
    const where: Prisma.TemplateWhereInput = {
      tenantId,
      branchId: scopeBranchId,
      deletedAt: null,
    };
    if (type) {
      where.type = type;
    }
    const data = await this.prisma.template.findMany({
      where,
      select: { id: true, name: true },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
    });
    const total = await this.prisma.template.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update a template. `type` and `code` are immutable. When any config-affecting
   * field (`subject`/`consent`/`whatsapp`/`report`) is supplied the whole `config`
   * JSON is rebuilt from the existing row's type; otherwise it is left unchanged.
   * Shared blocks (`header`/`footerBlock`/`attachment`) are replaced when present.
   * @param id template id
   * @param tenantId tenant scope
   * @param scopeBranchId active branch, or null for tenant-level
   * @param dto partial update
   * @param actorId person id of the editor (optional audit trail)
   * @throws TemplateNotFoundException / TemplateNameConflictException
   */
  async update(
    id: string,
    tenantId: string,
    scopeBranchId: string | null,
    dto: UpdateTemplateDto,
    actorId?: string,
  ): Promise<Template> {
    const existing = await this.findById(id, tenantId, scopeBranchId);

    const data: Prisma.TemplateUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.triggerEvent !== undefined) data.triggerEvent = dto.triggerEvent;
    if (dto.version !== undefined) data.version = dto.version;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.body !== undefined) data.body = dto.body;

    const touchesConfig =
      dto.subject !== undefined ||
      dto.consent !== undefined ||
      dto.whatsapp !== undefined ||
      dto.report !== undefined;
    if (touchesConfig) {
      data.config = this.buildConfig(existing.type, dto);
    }
    if (dto.header !== undefined) data.headerBlock = this.asJson(dto.header);
    if (dto.footerBlock !== undefined) {
      data.footerBlock = this.asJson(dto.footerBlock);
    }
    if (dto.attachment !== undefined) {
      data.attachment = this.asJson(dto.attachment);
    }
    // Only stamp the actor when one was supplied — never clobber an existing
    // updatedBy with null on actor-less internal calls.
    if (actorId !== undefined) {
      data.updatedBy = actorId;
    }

    try {
      return await this.prisma.withTenant(tenantId, (tx) =>
        tx.template.update({ where: { id }, data }),
      );
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name ?? existing.name);
      throw e;
    }
  }

  /**
   * Soft-delete a template (sets `deletedAt`; the row is preserved).
   * @param id template id
   * @param tenantId tenant scope
   * @param scopeBranchId active branch, or null for tenant-level
   * @throws TemplateNotFoundException if missing/soft-deleted
   */
  async remove(
    id: string,
    tenantId: string,
    scopeBranchId: string | null,
  ): Promise<Template> {
    await this.findById(id, tenantId, scopeBranchId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.template.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  /**
   * Duplicate a template within the same scope: a deep copy with a fresh `code`,
   * " (Copy)" appended to the name, and the version reset to `v1.0`. All JSON
   * config/blocks are copied verbatim.
   * @param id source template id
   * @param tenantId tenant scope
   * @param scopeBranchId active branch, or null for tenant-level
   * @param actorId person id of the creator (optional audit trail)
   * @throws TemplateNotFoundException if the source is missing/soft-deleted
   * @throws TemplateNameConflictException if the copied name already exists
   */
  async duplicate(
    id: string,
    tenantId: string,
    scopeBranchId: string | null,
    actorId?: string,
  ): Promise<Template> {
    const source = await this.findById(id, tenantId, scopeBranchId);
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { templateCounter: { increment: 1 } },
          select: { templateCounter: true, name: true },
        });
        const code = `${this.buildInitials(tenant.name)}-Tpl-${tenant.templateCounter - 1}`;
        return tx.template.create({
          data: {
            tenantId,
            branchId: source.branchId,
            type: source.type,
            name: `${source.name} (Copy)`,
            code,
            triggerEvent: source.triggerEvent,
            version: 'v1.0',
            isActive: source.isActive,
            body: source.body,
            config: source.config as Prisma.InputJsonValue,
            headerBlock: this.copyJson(source.headerBlock),
            footerBlock: this.copyJson(source.footerBlock),
            attachment: this.copyJson(source.attachment),
            createdBy: actorId ?? null,
            updatedBy: actorId ?? null,
          },
        });
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, `${source.name} (Copy)`);
      throw e;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Assemble the type-specific `config` JSON from the relevant DTO fields. Each
   * type's config is fully determined by one field/block, so this is a complete
   * (re)build — used on create, update (when a config field changes), and never
   * needs to merge.
   * @param type the template's (immutable) type
   * @param src the DTO fields that feed the config
   */
  private buildConfig(
    type: TemplateType,
    src: ConfigSource,
  ): Prisma.InputJsonValue {
    switch (type) {
      case TemplateType.EMAIL:
        return { subject: src.subject ?? '' };
      case TemplateType.CONSENT_FORM:
        return src.consent
          ? {
              signatureRequired: src.consent.signatureRequired,
              consent: { ...src.consent.consent },
            }
          : {};
      case TemplateType.WHATSAPP:
        return src.whatsapp ? { whatsapp: { ...src.whatsapp } } : {};
      case TemplateType.REPORT_TEMPLATE:
        return src.report
          ? { ...src.report, reportRefs: { ...(src.report.reportRefs ?? {}) } }
          : {};
      case TemplateType.SMS:
      default:
        return {};
    }
  }

  /** Cast a validated block DTO into a Prisma JSON value (it is plain data). */
  private asJson(block: object): Prisma.InputJsonValue {
    return block;
  }

  /**
   * Copy an existing nullable JSON column for duplication: `null` columns stay
   * unset (undefined), present values are passed through.
   */
  private copyJson(
    value: Prisma.JsonValue | null,
  ): Prisma.InputJsonValue | undefined {
    return value == null ? undefined : value;
  }

  /**
   * Derive a template-code prefix from a tenant name: the first letter of up to
   * the first three words, uppercased, letters only (e.g. "Apex Bio Care" →
   * "ABC"). Falls back to "TPL" when the name has no letters.
   * @param name the tenant's business name
   */
  private buildInitials(name: string): string {
    const initials = name
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .slice(0, 3)
      .map((w) => w.replace(/[^a-zA-Z]/g, '').charAt(0))
      .filter((c) => c.length > 0)
      .join('')
      .toUpperCase();
    return initials.length > 0 ? initials : 'TPL';
  }

  /**
   * If the caught error is a Prisma unique-constraint violation (P2002) on a
   * name index, throw the typed 409. The system-generated `code` index never
   * collides in practice (per-tenant sequential), so a `code` violation is left
   * to bubble up as an internal error. Returns normally for any other error so
   * the caller can rethrow.
   * @param e the caught error
   * @param name the attempted name (for the conflict's context)
   * @throws TemplateNameConflictException
   */
  private rethrowUniqueViolation(e: unknown, name: string): void {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== 'P2002'
    ) {
      return;
    }
    const target = String(
      (e.meta as { target?: string | string[] } | undefined)?.target ?? '',
    );
    if (target.includes('name')) {
      throw new TemplateNameConflictException(name);
    }
  }
}
