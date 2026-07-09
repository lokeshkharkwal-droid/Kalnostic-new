import { Injectable } from '@nestjs/common';
import {
  ApplicableBranchType,
  MessageType,
  MessagingChannel,
  MessagingLevel,
  Prisma,
  Template,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { TemplateNotFoundException } from './exceptions/template.exceptions';

/** Filters shared by the tenant and global list queries. */
interface ListFilters {
  preference?: MessagingChannel;
  feature?: string;
  messageType?: MessageType;
  level?: MessagingLevel;
  applicableBranchType?: ApplicableBranchType;
  search?: string;
  isActive?: boolean;
  isEnabled?: boolean;
  isDefault?: boolean;
}

/** Dropdown row shape returned by `lookup`. */
export interface TemplateLookupRow {
  id: string;
  displayTitle: string | null;
  preference: MessagingChannel;
  feature: string;
}

/**
 * Messaging template management. Tenant-scoped + branch-level (CLAUDE.md
 * §4.6/§4.7): `branchId` is NULL for tenant-level templates (business-admin) and
 * the active branch for branch-level templates (branch-admin). The scope is
 * decided by the caller (from `@CurrentProfile()`) and passed as `scopeBranchId`;
 * the two scopes are independent. Every query carries `tenantId` (defence in
 * depth on top of RLS) and filters soft-deleted rows. SITE_ADMIN global master
 * templates carry `tenantId: null` and are managed via the `*Global` methods.
 */
@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Create a messaging template in the caller's scope.
   * @param tenantId owning tenant (from JWT)
   * @param scopeBranchId active branch (branch-admin) or null (business-admin)
   * @param dto validated template payload (no `tenantId`/`branchId`)
   * @param actorId person id of the creator (optional audit trail)
   * @returns the created template
   * @throws BranchNotFoundException if a non-null scope branch isn't in the tenant
   */
  async create(
    tenantId: string,
    scopeBranchId: string | null,
    dto: CreateTemplateDto,
    actorId?: string,
  ): Promise<Template> {
    // Validate the scope branch belongs to the caller's tenant (§4.7).
    if (scopeBranchId !== null) {
      await this.branchService.findById(scopeBranchId, tenantId);
    }
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.template.create({
        data: {
          tenantId,
          branchId: scopeBranchId,
          ...this.buildCreateData(dto),
          createdBy: actorId ?? null,
          updatedBy: actorId ?? null,
        },
      }),
    );
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
   * @param filters optional channel/feature/type/level/branch-type filters, a
   *   case-insensitive `displayTitle` search, and the boolean flags
   */
  async findAll(
    tenantId: string,
    scopeBranchId: string | null,
    page = 1,
    limit = 20,
    filters: ListFilters = {},
  ): Promise<PaginatedResult<Template>> {
    const where = this.buildWhere(
      { tenantId, branchId: scopeBranchId, deletedAt: null },
      filters,
    );
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
   * Partial, dropdown-optimised listing: returns `{ id, displayTitle,
   * preference, feature }` per row, scoped to the caller's tenant + branch (from
   * the JWT, never the query), with optional channel/feature filters and offset
   * pagination. Ordered by `createdAt` descending.
   * @param tenantId tenant scope
   * @param scopeBranchId active branch, or null for tenant-level
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional `preference`/`feature` filters
   */
  async lookup(
    tenantId: string,
    scopeBranchId: string | null,
    page = 1,
    limit = 20,
    filters: { preference?: MessagingChannel; feature?: string } = {},
  ): Promise<PaginatedResult<TemplateLookupRow>> {
    const where = this.buildWhere(
      { tenantId, branchId: scopeBranchId, deletedAt: null },
      filters,
    );
    const data = await this.prisma.template.findMany({
      where,
      select: { id: true, displayTitle: true, preference: true, feature: true },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.template.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update a template in the caller's scope. Only fields present on the DTO are
   * changed; the scope (tenant/branch) is fixed.
   * @param id template id
   * @param tenantId tenant scope
   * @param scopeBranchId active branch, or null for tenant-level
   * @param dto partial update
   * @param actorId person id of the editor (optional audit trail)
   * @throws TemplateNotFoundException if missing/soft-deleted
   */
  async update(
    id: string,
    tenantId: string,
    scopeBranchId: string | null,
    dto: UpdateTemplateDto,
    actorId?: string,
  ): Promise<Template> {
    await this.findById(id, tenantId, scopeBranchId);
    const data = this.buildUpdateData(dto);
    if (actorId !== undefined) {
      data.updatedBy = actorId;
    }
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.template.update({ where: { id }, data }),
    );
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
   * Duplicate a template within the same scope: a copy with " (Copy)" appended
   * to the display title (or a default title when the source had none).
   * @param id source template id
   * @param tenantId tenant scope
   * @param scopeBranchId active branch, or null for tenant-level
   * @param actorId person id of the creator (optional audit trail)
   * @throws TemplateNotFoundException if the source is missing/soft-deleted
   */
  async duplicate(
    id: string,
    tenantId: string,
    scopeBranchId: string | null,
    actorId?: string,
  ): Promise<Template> {
    const source = await this.findById(id, tenantId, scopeBranchId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.template.create({
        data: {
          ...this.cloneData(source),
          tenantId,
          branchId: source.branchId,
          createdBy: actorId ?? null,
          updatedBy: actorId ?? null,
        },
      }),
    );
  }

  // ── SITE_ADMIN global master templates (tenant_id NULL) ─────────────────────
  // Global templates are shared across tenants and managed by SiteAdmin. They
  // carry no tenant and no branch, so writes go through the plain Prisma client
  // (no `withTenant` GUC) — the RLS `WITH CHECK` permits NULL-tenant rows only
  // when the connection has no tenant set (mirrors the pdf_report_templates
  // pattern).

  /**
   * Create a global (SITE_ADMIN) master template. `tenantId`/`branchId` are null.
   * @param dto validated template payload
   * @param actorId siteadmin id for the audit trail (optional)
   * @returns the created global template
   */
  async createGlobal(
    dto: CreateTemplateDto,
    actorId?: string,
  ): Promise<Template> {
    return this.prisma.template.create({
      data: {
        tenantId: null,
        branchId: null,
        ...this.buildCreateData(dto),
        createdBy: actorId ?? null,
        updatedBy: actorId ?? null,
      },
    });
  }

  /**
   * List active global (SITE_ADMIN) templates (offset pagination).
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters same filter set as the tenant list
   */
  async findAllGlobal(
    page = 1,
    limit = 20,
    filters: ListFilters = {},
  ): Promise<PaginatedResult<Template>> {
    const where = this.buildWhere({ tenantId: null, deletedAt: null }, filters);
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
   * Fetch one active global (SITE_ADMIN) template.
   * @param id template id
   * @throws TemplateNotFoundException if missing/soft-deleted/not global
   */
  async findGlobalById(id: string): Promise<Template> {
    const template = await this.prisma.template.findFirst({
      where: { id, tenantId: null, deletedAt: null },
    });
    if (!template) {
      throw new TemplateNotFoundException(id);
    }
    return template;
  }

  /**
   * Update a global (SITE_ADMIN) template.
   * @param id template id
   * @param dto partial update
   * @param actorId siteadmin id for the audit trail (optional)
   * @throws TemplateNotFoundException if missing/soft-deleted/not global
   */
  async updateGlobal(
    id: string,
    dto: UpdateTemplateDto,
    actorId?: string,
  ): Promise<Template> {
    await this.findGlobalById(id);
    const data = this.buildUpdateData(dto);
    if (actorId !== undefined) {
      data.updatedBy = actorId;
    }
    return this.prisma.template.update({ where: { id }, data });
  }

  /**
   * Soft-delete a global (SITE_ADMIN) template.
   * @param id template id
   * @throws TemplateNotFoundException if missing/soft-deleted/not global
   */
  async removeGlobal(id: string): Promise<Template> {
    await this.findGlobalById(id);
    return this.prisma.template.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Duplicate a global (SITE_ADMIN) template: a copy with " (Copy)" appended to
   * the display title.
   * @param id source template id
   * @param actorId siteadmin id for the audit trail (optional)
   * @throws TemplateNotFoundException if the source is missing/soft-deleted
   */
  async duplicateGlobal(id: string, actorId?: string): Promise<Template> {
    const source = await this.findGlobalById(id);
    return this.prisma.template.create({
      data: {
        ...this.cloneData(source),
        tenantId: null,
        branchId: null,
        createdBy: actorId ?? null,
        updatedBy: actorId ?? null,
      },
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Extend a base `where` (scope + soft-delete) with the optional list filters.
   * @param base the scope predicate (`tenantId`/`branchId`/`deletedAt`)
   * @param filters user-supplied filters
   */
  private buildWhere(
    base: Prisma.TemplateWhereInput,
    filters: ListFilters & { preference?: MessagingChannel; feature?: string },
  ): Prisma.TemplateWhereInput {
    const where: Prisma.TemplateWhereInput = { ...base };
    if (filters.preference) where.preference = filters.preference;
    if (filters.feature) where.feature = filters.feature;
    if (filters.messageType) where.messageType = filters.messageType;
    if (filters.level) where.level = filters.level;
    if (filters.applicableBranchType) {
      where.applicableBranchType = filters.applicableBranchType;
    }
    const search = filters.search?.trim();
    if (search) {
      where.displayTitle = { contains: search, mode: 'insensitive' };
    }
    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.isEnabled !== undefined) where.isEnabled = filters.isEnabled;
    if (filters.isDefault !== undefined) where.isDefault = filters.isDefault;
    return where;
  }

  /**
   * Map a create DTO onto the Prisma create payload (channel + feature + all
   * optional settings), applying the model defaults for the boolean flags.
   * Excludes scope/actor fields, which the caller sets from context.
   * @param dto validated create payload
   */
  private buildCreateData(
    dto: CreateTemplateDto,
  ): Omit<
    Prisma.TemplateUncheckedCreateInput,
    'tenantId' | 'branchId' | 'createdBy' | 'updatedBy'
  > {
    return {
      preference: dto.preference,
      feature: dto.feature,
      displayTitle: dto.displayTitle ?? null,
      messageType: dto.messageType ?? null,
      isActive: dto.isActive ?? true,
      isDefault: dto.isDefault ?? false,
      isEnabled: dto.isEnabled ?? false,
      specificApplication: dto.specificApplication ?? null,
      applicableBranchType: dto.applicableBranchType ?? null,
      level: dto.level ?? MessagingLevel.BUSINESS,
      entityId: dto.entityId ?? null,
      entityType: dto.entityType ?? null,
      smsTemplateId: dto.smsTemplateId ?? null,
      smsSenderId: dto.smsSenderId ?? null,
      smsType: dto.smsType ?? null,
      template: dto.template,
      templateType: dto.templateType ?? null,
      templateCategory: dto.templateCategory ?? null,
      fileName: dto.fileName ?? null,
    };
  }

  /**
   * Map a partial update DTO onto a Prisma update payload — only keys present on
   * the DTO are included (so untouched columns are left as-is).
   * @param dto partial update payload
   */
  private buildUpdateData(dto: UpdateTemplateDto): Prisma.TemplateUpdateInput {
    const data: Prisma.TemplateUpdateInput = {};
    if (dto.preference !== undefined) data.preference = dto.preference;
    if (dto.feature !== undefined) data.feature = dto.feature;
    if (dto.displayTitle !== undefined) data.displayTitle = dto.displayTitle;
    if (dto.messageType !== undefined) data.messageType = dto.messageType;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if (dto.isEnabled !== undefined) data.isEnabled = dto.isEnabled;
    if (dto.specificApplication !== undefined) {
      data.specificApplication = dto.specificApplication;
    }
    if (dto.applicableBranchType !== undefined) {
      data.applicableBranchType = dto.applicableBranchType;
    }
    if (dto.level !== undefined) data.level = dto.level;
    if (dto.entityId !== undefined) data.entityId = dto.entityId;
    if (dto.entityType !== undefined) data.entityType = dto.entityType;
    if (dto.smsTemplateId !== undefined) data.smsTemplateId = dto.smsTemplateId;
    if (dto.smsSenderId !== undefined) data.smsSenderId = dto.smsSenderId;
    if (dto.smsType !== undefined) data.smsType = dto.smsType;
    if (dto.template !== undefined) data.template = dto.template;
    if (dto.templateType !== undefined) data.templateType = dto.templateType;
    if (dto.templateCategory !== undefined) {
      data.templateCategory = dto.templateCategory;
    }
    if (dto.fileName !== undefined) data.fileName = dto.fileName;
    return data;
  }

  /**
   * Build the create payload for a duplicate: copy every content/config column
   * from the source, appending " (Copy)" to the display title. Scope and actor
   * fields are set by the caller.
   * @param source the template being duplicated
   */
  private cloneData(
    source: Template,
  ): Omit<
    Prisma.TemplateUncheckedCreateInput,
    'tenantId' | 'branchId' | 'createdBy' | 'updatedBy'
  > {
    return {
      preference: source.preference,
      feature: source.feature,
      displayTitle: source.displayTitle
        ? `${source.displayTitle} (Copy)`
        : 'Untitled (Copy)',
      messageType: source.messageType,
      isActive: source.isActive,
      isDefault: false,
      isEnabled: source.isEnabled,
      specificApplication: source.specificApplication,
      applicableBranchType: source.applicableBranchType,
      level: source.level,
      entityId: source.entityId,
      entityType: source.entityType,
      smsTemplateId: source.smsTemplateId,
      smsSenderId: source.smsSenderId,
      smsType: source.smsType,
      template: source.template,
      templateType: source.templateType,
      templateCategory: source.templateCategory,
      fileName: source.fileName,
    };
  }
}
