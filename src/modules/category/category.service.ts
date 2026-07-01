import { Injectable } from '@nestjs/common';
import {
  CategoryType,
  DataSource,
  DoctorType,
  PersonMappingType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { DepartmentService } from '../department/department.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateCategoryTemplateDto } from './dto/create-category-template.dto';
import { UpdateCategoryTemplateDto } from './dto/update-category-template.dto';
import { CategoryPersonMappingDto } from './dto/category-person-mapping.dto';
import {
  CategoryEntity,
  CategoryWithMappings,
} from './entities/category.entity';
import {
  CategoryDepartmentRequiredException,
  CategoryNameConflictException,
  CategoryNotFoundException,
  CategoryShortNameConflictException,
  DuplicateDefaultPositionException,
  IndependentCategoryDepartmentException,
  InvalidCategoryPriorityException,
  InvalidPersonMappingReferenceException,
  PersonNotFoundException,
} from './exceptions/category.exceptions';

/** The single SiteAdminCounter row id (schema `@default("global")`). */
const SITE_ADMIN_COUNTER_ID = 'global';

/** Eager-load active person mappings, ordered by priority. */
const MAPPINGS_INCLUDE = {
  personMappings: {
    where: { deletedAt: null },
    orderBy: { priority: 'asc' },
  },
} satisfies Prisma.CategoryInclude;

/**
 * Category management. Tenant-scoped, tenant-level (CLAUDE.md §4.6). Mirrors
 * DepartmentService, plus a type dimension: a category is INDEPENDENT (no
 * department) or UNDER_DEPARTMENT (linked to an active department of the same
 * tenant). Every query carries `tenantId` (defence in depth on top of RLS,
 * §4.3) and filters soft-deleted rows.
 */
@Injectable()
export class CategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departmentService: DepartmentService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Create a category in a tenant. The `code` is system-generated and
   * immutable: `{INITIALS}-Cat-{n}`, where INITIALS are derived from the tenant
   * name and `n` is a 0-based per-tenant sequence taken by atomically
   * incrementing `Tenant.categoryCounter` in the same transaction (so concurrent
   * creates never collide). The department link is resolved/validated against
   * `categoryType` first; person mappings (if any) are validated before insert.
   * @param tenantId owning tenant
   * @param dto validated category payload (no `code` — generated here)
   * @returns the created category with its active person mappings
   * @throws CategoryDepartmentRequiredException / IndependentCategoryDepartmentException
   *   if the type↔department combination is invalid
   * @throws DepartmentNotFoundException if UNDER_DEPARTMENT references a
   *   department that isn't an active department of this tenant
   * @throws CategoryNameConflictException if the name is already used by an
   *   active category in this tenant
   * @throws CategoryShortNameConflictException if the shortName is already used
   *   by an active category in the same scope (parent department, or per tenant
   *   for INDEPENDENT)
   * @throws InvalidCategoryPriorityException / DuplicateDefaultPositionException
   *   / PersonNotFoundException if the person mappings are invalid
   */
  async create(
    tenantId: string,
    dto: CreateCategoryDto,
  ): Promise<CategoryWithMappings> {
    const mappings = dto.personMappings ?? [];
    const departmentId = await this.resolveDepartmentLink(
      tenantId,
      dto.categoryType,
      dto.departmentId,
    );
    // Validate any client-supplied branchIds against the tenant first (§4.7),
    // on the base client before opening the RLS transaction.
    await this.validateBranches(tenantId, mappings);
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { categoryCounter: { increment: 1 } },
          select: { categoryCounter: true, name: true },
        });
        // 0-based sequence: the first category in a tenant is `…-Cat-0`. The
        // counter is post-increment, so subtract 1 for this category's index.
        const sequence = tenant.categoryCounter - 1;
        const code = `${this.buildInitials(tenant.name)}-Cat-${sequence}`;

        await this.validatePersonMappings(tx, tenantId, mappings);

        return tx.category.create({
          data: {
            tenantId,
            name: dto.name,
            shortName: dto.shortName,
            description: dto.description ?? null,
            code,
            isActive: dto.isActive ?? true,
            categoryType: dto.categoryType,
            departmentId,
            moduleMapping: dto.moduleMapping,
            personMappings: {
              create: mappings.map((m) => this.toMappingCreate(tenantId, m)),
            },
          },
          include: MAPPINGS_INCLUDE,
        });
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name, dto.shortName);
      throw e;
    }
  }

  /**
   * Fetch one active category scoped to its tenant, with active person mappings.
   * @param id category id
   * @param tenantId tenant scope
   * @throws CategoryNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<CategoryWithMappings> {
    const category = await this.prisma.category.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: MAPPINGS_INCLUDE,
    });
    if (!category) {
      throw new CategoryNotFoundException(id);
    }
    return category;
  }

  /**
   * List active categories for a tenant (offset pagination), each with its
   * active person mappings.
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (matched against `name`
   *   or `code`), a `categoryType` filter, an active/inactive `status` filter,
   *   and a cascading `departmentId` filter
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
    filters: {
      search?: string;
      categoryType?: CategoryType;
      status?: 'ACTIVE' | 'INACTIVE';
      departmentId?: string;
    } = {},
  ): Promise<PaginatedResult<CategoryWithMappings>> {
    const where: Prisma.CategoryWhereInput = { tenantId, deletedAt: null };
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filters.categoryType) {
      where.categoryType = filters.categoryType;
    }
    if (filters.status) {
      where.isActive = filters.status === 'ACTIVE';
    }
    if (filters.departmentId) {
      where.departmentId = filters.departmentId;
    }
    // Sequential (not array-`$transaction`) so each call flows through the RLS
    // extension and carries the tenant GUC when RLS is enabled.
    const data = await this.prisma.category.findMany({
      where,
      include: MAPPINGS_INCLUDE,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.category.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update a category. `code` is immutable and never changes. When either
   * `categoryType` or `departmentId` is supplied the resulting link is
   * re-resolved and re-validated (switching INDEPENDENT ↔ UNDER_DEPARTMENT is
   * allowed). When `personMappings` is supplied it REPLACES the whole set:
   * existing active mappings are soft-deleted and the new set is created
   * (validated first), all inside one transaction.
   * @param id category id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws CategoryNotFoundException if missing/soft-deleted
   * @throws CategoryDepartmentRequiredException / IndependentCategoryDepartmentException
   *   / DepartmentNotFoundException if the new type↔department combination is invalid
   * @throws CategoryNameConflictException on a name collision
   * @throws CategoryShortNameConflictException on a shortName collision in scope
   * @throws InvalidCategoryPriorityException / DuplicateDefaultPositionException
   *   / PersonNotFoundException if the replacement mappings are invalid
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryWithMappings> {
    const existing = await this.findById(id, tenantId);

    // Re-resolve the department link only when the caller touches either field.
    let resolvedDepartmentId: string | null | undefined;
    if (dto.categoryType !== undefined || dto.departmentId !== undefined) {
      const effectiveType = dto.categoryType ?? existing.categoryType;
      const candidate =
        effectiveType === CategoryType.UNDER_DEPARTMENT
          ? (dto.departmentId ?? existing.departmentId ?? undefined)
          : dto.departmentId; // INDEPENDENT: any supplied id is rejected below
      resolvedDepartmentId = await this.resolveDepartmentLink(
        tenantId,
        effectiveType,
        candidate ?? undefined,
      );
    }

    if (dto.personMappings !== undefined) {
      // Validate branchIds before the RLS transaction (§4.7), as in create().
      await this.validateBranches(tenantId, dto.personMappings);
    }

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const data: Prisma.CategoryUpdateInput = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.shortName !== undefined) data.shortName = dto.shortName;
        if (dto.description !== undefined) {
          data.description = dto.description ?? null;
        }
        if (dto.isActive !== undefined) data.isActive = dto.isActive;
        if (dto.moduleMapping !== undefined) {
          data.moduleMapping = dto.moduleMapping;
        }
        if (dto.categoryType !== undefined)
          data.categoryType = dto.categoryType;
        if (resolvedDepartmentId !== undefined) {
          // Scalar FK write (string | null) — connects or clears the department.
          data.department =
            resolvedDepartmentId === null
              ? { disconnect: true }
              : { connect: { id: resolvedDepartmentId } };
        }
        // `code` is immutable and system-generated — never updated here.

        if (dto.personMappings !== undefined) {
          await this.validatePersonMappings(
            tx,
            tenantId,
            dto.personMappings,
            id,
          );
          // Replace the set: soft-delete the current active rows, create anew.
          await tx.categoryPersonMapping.updateMany({
            where: { categoryId: id, tenantId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          data.personMappings = {
            create: dto.personMappings.map((m) =>
              this.toMappingCreate(tenantId, m),
            ),
          };
        }

        return tx.category.update({
          where: { id },
          data,
          include: MAPPINGS_INCLUDE,
        });
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name ?? '', dto.shortName ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a category and its active person mappings (sets `deletedAt`;
   * rows are preserved) in one transaction.
   * @param id category id
   * @param tenantId tenant scope
   * @throws CategoryNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<CategoryWithMappings> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.categoryPersonMapping.updateMany({
        where: { categoryId: id, tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return tx.category.update({
        where: { id },
        data: { deletedAt: new Date() },
        include: MAPPINGS_INCLUDE,
      });
    });
  }

  // ── Site Admin global templates ─────────────────────────────────────────────

  /**
   * Create a SITE_ADMIN global category template (no tenant/branch, no person
   * mappings). For UNDER_DEPARTMENT, `departmentId` must reference a SITE_ADMIN
   * department template. The `code` is system-generated `SA-Cat-{n}` from the
   * global `SiteAdminCounter`. Runs in a plain transaction (no tenant GUC).
   * @param dto validated template payload (no `code` — generated here)
   * @returns the created template
   * @throws CategoryDepartmentRequiredException / IndependentCategoryDepartmentException
   *   if the type↔department combination is invalid
   * @throws DepartmentNotFoundException if UNDER_DEPARTMENT references a
   *   department that isn't an active SITE_ADMIN template
   * @throws CategoryNameConflictException / CategoryShortNameConflictException on a clash
   */
  async createTemplate(
    dto: CreateCategoryTemplateDto,
  ): Promise<CategoryEntity> {
    const departmentId = await this.resolveTemplateDepartmentLink(
      dto.categoryType,
      dto.departmentId,
    );
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const code = await this.mintTemplateCode(tx);
        const created = await tx.category.create({
          data: {
            tenantId: null,
            source: DataSource.SITE_ADMIN,
            name: dto.name,
            shortName: dto.shortName,
            description: dto.description ?? null,
            code,
            isActive: dto.isActive ?? true,
            categoryType: dto.categoryType,
            departmentId,
            moduleMapping: dto.moduleMapping,
          },
        });
        return created.id;
      });
      return this.findTemplateById(id);
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name, dto.shortName);
      throw e;
    }
  }

  /**
   * List active SITE_ADMIN category templates (offset pagination).
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional `search` (name/code), `categoryType`, `status`, and
   *   a cascading `departmentId` filter
   */
  async findAllTemplates(
    page = 1,
    limit = 20,
    filters: {
      search?: string;
      categoryType?: CategoryType;
      status?: 'ACTIVE' | 'INACTIVE';
      departmentId?: string;
    } = {},
  ): Promise<PaginatedResult<CategoryEntity>> {
    const where: Prisma.CategoryWhereInput = {
      source: DataSource.SITE_ADMIN,
      tenantId: null,
      deletedAt: null,
    };
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filters.categoryType) {
      where.categoryType = filters.categoryType;
    }
    if (filters.status) {
      where.isActive = filters.status === 'ACTIVE';
    }
    if (filters.departmentId) {
      where.departmentId = filters.departmentId;
    }
    const data = await this.prisma.category.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.category.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active SITE_ADMIN category template.
   * @param id template id
   * @throws CategoryNotFoundException if missing/soft-deleted/not a template
   */
  async findTemplateById(id: string): Promise<CategoryEntity> {
    const category = await this.prisma.category.findFirst({
      where: {
        id,
        source: DataSource.SITE_ADMIN,
        tenantId: null,
        deletedAt: null,
      },
    });
    if (!category) {
      throw new CategoryNotFoundException(id);
    }
    return category;
  }

  /**
   * Update a SITE_ADMIN category template. `code` is immutable. When
   * `categoryType`/`departmentId` is supplied the parent link is re-resolved
   * against SITE_ADMIN department templates (INDEPENDENT ↔ UNDER_DEPARTMENT
   * allowed).
   * @param id template id
   * @param dto partial update
   * @throws CategoryNotFoundException if missing/soft-deleted/not a template
   * @throws CategoryDepartmentRequiredException / IndependentCategoryDepartmentException
   *   / DepartmentNotFoundException if the new type↔department combination is invalid
   * @throws CategoryNameConflictException / CategoryShortNameConflictException on a clash
   */
  async updateTemplate(
    id: string,
    dto: UpdateCategoryTemplateDto,
  ): Promise<CategoryEntity> {
    const existing = await this.findTemplateById(id);
    let resolvedDepartmentId: string | null | undefined;
    if (dto.categoryType !== undefined || dto.departmentId !== undefined) {
      const effectiveType = dto.categoryType ?? existing.categoryType;
      const candidate =
        effectiveType === CategoryType.UNDER_DEPARTMENT
          ? (dto.departmentId ?? existing.departmentId ?? undefined)
          : dto.departmentId;
      resolvedDepartmentId = await this.resolveTemplateDepartmentLink(
        effectiveType,
        candidate ?? undefined,
      );
    }
    const data: Prisma.CategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.shortName !== undefined) data.shortName = dto.shortName;
    if (dto.description !== undefined)
      data.description = dto.description ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.moduleMapping !== undefined) data.moduleMapping = dto.moduleMapping;
    if (dto.categoryType !== undefined) data.categoryType = dto.categoryType;
    if (resolvedDepartmentId !== undefined) {
      data.department =
        resolvedDepartmentId === null
          ? { disconnect: true }
          : { connect: { id: resolvedDepartmentId } };
    }
    try {
      return await this.prisma.category.update({ where: { id }, data });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name ?? '', dto.shortName ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a SITE_ADMIN category template (sets `deletedAt`).
   * @param id template id
   * @throws CategoryNotFoundException if missing/soft-deleted/not a template
   */
  async removeTemplate(id: string): Promise<CategoryEntity> {
    await this.findTemplateById(id);
    return this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Clone / adoption (SITE_ADMIN template → tenant) ──────────────────────────

  /**
   * Adopt a SITE_ADMIN category template into the caller's tenant catalogue,
   * cascade-cloning its parent department template (UNDER_DEPARTMENT) too. A
   * fresh tenant `code` is minted. Idempotent: a template already cloned into the
   * tenant (and any already-cloned parent) is reused, not duplicated. Fully
   * transactional.
   * @param templateId the SITE_ADMIN template to clone
   * @param tenantId caller's tenant
   * @returns the tenant category (existing clone or newly created)
   * @throws CategoryNotFoundException if `templateId` is not a live template
   * @throws DepartmentNotFoundException if the parent department template is gone
   * @throws CategoryNameConflictException / CategoryShortNameConflictException on a clash
   */
  async cloneToTenant(
    templateId: string,
    tenantId: string,
  ): Promise<CategoryWithMappings> {
    let newId: string;
    try {
      newId = await this.prisma.withTenant(tenantId, async (tx) => {
        const cloned = await this.cloneTemplateWithinTx(
          tx,
          templateId,
          tenantId,
        );
        return cloned.id;
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, '', '');
      throw e;
    }
    return this.findById(newId, tenantId);
  }

  /**
   * Clone a SITE_ADMIN category template into a tenant within an EXISTING
   * transaction — reused by SubCategoryService when cascading a parent-category
   * clone. Reuses an existing clone (matched by `clonedFromId`) when present, and
   * cascade-clones the parent department template for UNDER_DEPARTMENT. The new
   * row is `source = TENANT` with a fresh tenant `code` and `clonedFromId` set;
   * no person mappings.
   * @param tx the caller's transaction client (already in `withTenant`)
   * @param templateId the SITE_ADMIN template category to clone
   * @param tenantId target tenant
   * @returns the tenant category (existing clone or newly created)
   * @throws CategoryNotFoundException if `templateId` is not a live template
   */
  async cloneTemplateWithinTx(
    tx: Prisma.TransactionClient,
    templateId: string,
    tenantId: string,
  ): Promise<CategoryEntity> {
    const existing = await tx.category.findFirst({
      where: { tenantId, clonedFromId: templateId, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    const template = await tx.category.findFirst({
      where: {
        id: templateId,
        source: DataSource.SITE_ADMIN,
        tenantId: null,
        deletedAt: null,
      },
    });
    if (!template) {
      throw new CategoryNotFoundException(templateId);
    }
    let departmentId: string | null = null;
    if (
      template.categoryType === CategoryType.UNDER_DEPARTMENT &&
      template.departmentId
    ) {
      const clonedDept = await this.departmentService.cloneTemplateWithinTx(
        tx,
        template.departmentId,
        tenantId,
      );
      departmentId = clonedDept.id;
    }
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { categoryCounter: { increment: 1 } },
      select: { categoryCounter: true, name: true },
    });
    const code = `${this.buildInitials(tenant.name)}-Cat-${tenant.categoryCounter - 1}`;
    return tx.category.create({
      data: {
        tenantId,
        source: DataSource.TENANT,
        clonedFromId: templateId,
        name: template.name,
        shortName: template.shortName,
        description: template.description,
        code,
        isActive: template.isActive,
        categoryType: template.categoryType,
        departmentId,
        moduleMapping: template.moduleMapping,
      },
    });
  }

  /**
   * Resolve/validate the department link for a TEMPLATE category (mirrors
   * `resolveDepartmentLink` but validates against SITE_ADMIN department
   * templates): INDEPENDENT → null (rejects a supplied id); UNDER_DEPARTMENT →
   * required, must be an active SITE_ADMIN department template.
   * @param categoryType the (effective) category type
   * @param departmentId the candidate template department id, if any
   * @throws IndependentCategoryDepartmentException / CategoryDepartmentRequiredException
   *   / DepartmentNotFoundException
   */
  private async resolveTemplateDepartmentLink(
    categoryType: CategoryType,
    departmentId: string | undefined,
  ): Promise<string | null> {
    if (categoryType === CategoryType.INDEPENDENT) {
      if (departmentId) {
        throw new IndependentCategoryDepartmentException();
      }
      return null;
    }
    if (!departmentId) {
      throw new CategoryDepartmentRequiredException();
    }
    // Throws DepartmentNotFoundException if it isn't an active SITE_ADMIN template.
    await this.departmentService.findTemplateById(departmentId);
    return departmentId;
  }

  /**
   * Take the next global template sequence from the `SiteAdminCounter` singleton
   * (upserting on first use) and format `SA-Cat-{n}` (0-based, post-increment).
   * @param tx active transaction client
   */
  private async mintTemplateCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const counter = await tx.siteAdminCounter.upsert({
      where: { id: SITE_ADMIN_COUNTER_ID },
      create: { id: SITE_ADMIN_COUNTER_ID, categoryCounter: 1 },
      update: { categoryCounter: { increment: 1 } },
      select: { categoryCounter: true },
    });
    return `SA-Cat-${counter.categoryCounter - 1}`;
  }

  /**
   * Resolve and validate the department link implied by `categoryType`:
   *  - INDEPENDENT → must have no `departmentId` (else throws); returns null.
   *  - UNDER_DEPARTMENT → `departmentId` is required and must be an active
   *    department of this tenant (verified via DepartmentService.findById, which
   *    throws DepartmentNotFoundException otherwise); returns that id.
   * @param tenantId tenant scope
   * @param categoryType the (effective) category type
   * @param departmentId the candidate department id, if any
   * @returns the department id to persist (string for UNDER_DEPARTMENT, null for
   *   INDEPENDENT)
   * @throws IndependentCategoryDepartmentException / CategoryDepartmentRequiredException
   *   / DepartmentNotFoundException
   */
  private async resolveDepartmentLink(
    tenantId: string,
    categoryType: CategoryType,
    departmentId: string | undefined,
  ): Promise<string | null> {
    if (categoryType === CategoryType.INDEPENDENT) {
      if (departmentId) {
        throw new IndependentCategoryDepartmentException();
      }
      return null;
    }
    // UNDER_DEPARTMENT
    if (!departmentId) {
      throw new CategoryDepartmentRequiredException();
    }
    // Throws DepartmentNotFoundException if it isn't an active dept of the tenant.
    await this.departmentService.findById(departmentId, tenantId);
    return departmentId;
  }

  /**
   * Validate that every client-supplied `branchId` belongs to the caller's
   * tenant (CLAUDE.md §4.7 — never trust a branchId from the body). Runs on the
   * base client, before the RLS transaction is opened. Mappings without a
   * `branchId` are tenant-level and skipped.
   * @param tenantId tenant scope
   * @param mappings incoming mappings
   * @throws BranchNotFoundException if a branch is missing or in another tenant
   */
  private async validateBranches(
    tenantId: string,
    mappings: CategoryPersonMappingDto[],
  ): Promise<void> {
    const branchIds = [
      ...new Set(
        mappings
          .map((m) => m.branchId)
          .filter((b): b is string => b !== undefined),
      ),
    ];
    for (const branchId of branchIds) {
      await this.branchService.findById(branchId, tenantId);
    }
  }

  /**
   * Validate a set of person mappings before persisting (CLAUDE.md rule #2 —
   * the dynamic checks here can't be expressed with class-validator). All checks
   * are scoped per branch (a tenant-level mapping with no `branchId` forms its
   * own group), so one category can hold different personnel per branch:
   *  - at most one `isDefault` mapping per (branch, position) in the incoming set;
   *  - each `priority` is in `[1, max]`, where `max` is, for that mapping's
   *    branch, the tenant's active mappings for the same branch (outside this
   *    category) plus the incoming rows for that branch;
   *  - every referenced party exists and is active in the table its `type`
   *    resolves to.
   * @param tx active tenant transaction client
   * @param tenantId tenant scope
   * @param mappings incoming mappings
   * @param excludeCategoryId category whose existing rows are being replaced
   *   (omitted on create)
   * @throws DuplicateDefaultPositionException / InvalidCategoryPriorityException
   *   / PersonNotFoundException / InvalidPersonMappingReferenceException
   */
  private async validatePersonMappings(
    tx: Prisma.TransactionClient,
    tenantId: string,
    mappings: CategoryPersonMappingDto[],
    excludeCategoryId?: string,
  ): Promise<void> {
    if (mappings.length === 0) {
      return;
    }

    // At most one default per (branch, position) in the incoming set.
    const defaultsByBranchPosition = new Map<string, number>();
    for (const m of mappings) {
      if (m.isDefault) {
        const key = `${m.branchId ?? '∅'}|${m.position}`;
        const count = (defaultsByBranchPosition.get(key) ?? 0) + 1;
        if (count > 1) {
          throw new DuplicateDefaultPositionException(m.position);
        }
        defaultsByBranchPosition.set(key, count);
      }
    }

    // Priority cap is per branch: existing active mappings for the same branch
    // (outside this category) + the incoming rows for that branch.
    const incomingByBranch = new Map<
      string | null,
      CategoryPersonMappingDto[]
    >();
    for (const m of mappings) {
      const branchKey = m.branchId ?? null;
      const group = incomingByBranch.get(branchKey) ?? [];
      group.push(m);
      incomingByBranch.set(branchKey, group);
    }
    for (const [branchId, group] of incomingByBranch) {
      const existing = await tx.categoryPersonMapping.count({
        where: {
          tenantId,
          branchId,
          deletedAt: null,
          ...(excludeCategoryId
            ? { categoryId: { not: excludeCategoryId } }
            : {}),
        },
      });
      const max = existing + group.length;
      for (const m of group) {
        if (m.priority < 1 || m.priority > max) {
          throw new InvalidCategoryPriorityException(m.priority, max);
        }
      }
    }

    await this.validateReferences(tx, tenantId, mappings);
  }

  /**
   * Verify every mapping's `personId` resolves to an active row in the table its
   * `type` points at: USER → persons, CONSULTANT_DOCTOR/REPORTING_DOCTOR →
   * doctors (with a matching `doctorType`), EXTERNAL_REFERRAL →
   * external_referrals. Ids are grouped by type and checked in bulk.
   * @param tx active tenant transaction client
   * @param tenantId tenant scope (doctors/referrals are tenant-scoped)
   * @param mappings incoming mappings
   * @throws PersonNotFoundException for a missing USER reference
   * @throws InvalidPersonMappingReferenceException for a missing/mismatched
   *   doctor or external-referral reference
   */
  private async validateReferences(
    tx: Prisma.TransactionClient,
    tenantId: string,
    mappings: CategoryPersonMappingDto[],
  ): Promise<void> {
    const userIds = new Set<string>();
    const consultantIds = new Set<string>();
    const reportingIds = new Set<string>();
    const referralIds = new Set<string>();
    for (const m of mappings) {
      switch (m.type ?? PersonMappingType.USER) {
        case PersonMappingType.CONSULTANT_DOCTOR:
          consultantIds.add(m.personId);
          break;
        case PersonMappingType.REPORTING_DOCTOR:
          reportingIds.add(m.personId);
          break;
        case PersonMappingType.EXTERNAL_REFERRAL:
          referralIds.add(m.personId);
          break;
        default:
          userIds.add(m.personId);
      }
    }

    // USER → persons (platform-level, not tenant-scoped).
    if (userIds.size > 0) {
      const found = await tx.person.findMany({
        where: { id: { in: [...userIds] }, deletedAt: null },
        select: { id: true },
      });
      const foundIds = new Set(found.map((p) => p.id));
      for (const id of userIds) {
        if (!foundIds.has(id)) {
          throw new PersonNotFoundException(id);
        }
      }
    }

    // CONSULTANT_DOCTOR / REPORTING_DOCTOR → doctors, matching doctorType.
    await this.assertDoctors(
      tx,
      tenantId,
      consultantIds,
      DoctorType.CONSULTANT,
      PersonMappingType.CONSULTANT_DOCTOR,
    );
    await this.assertDoctors(
      tx,
      tenantId,
      reportingIds,
      DoctorType.REPORTING,
      PersonMappingType.REPORTING_DOCTOR,
    );

    // EXTERNAL_REFERRAL → external_referrals (tenant-scoped).
    if (referralIds.size > 0) {
      const found = await tx.externalReferral.findMany({
        where: { id: { in: [...referralIds] }, tenantId, deletedAt: null },
        select: { id: true },
      });
      const foundIds = new Set(found.map((r) => r.id));
      for (const id of referralIds) {
        if (!foundIds.has(id)) {
          throw new InvalidPersonMappingReferenceException(
            PersonMappingType.EXTERNAL_REFERRAL,
            id,
          );
        }
      }
    }
  }

  /**
   * Assert each id is an active doctor of this tenant with the expected
   * `doctorType` (so a CONSULTANT_DOCTOR mapping can't point at a REPORTING
   * doctor and vice-versa).
   * @param tx active tenant transaction client
   * @param tenantId tenant scope
   * @param ids doctor ids to verify (no-op when empty)
   * @param doctorType the doctorType the referenced doctors must have
   * @param mappingType the mapping type (for the thrown error's context)
   * @throws InvalidPersonMappingReferenceException on any missing/mismatched id
   */
  private async assertDoctors(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ids: Set<string>,
    doctorType: DoctorType,
    mappingType: PersonMappingType,
  ): Promise<void> {
    if (ids.size === 0) {
      return;
    }
    const found = await tx.doctor.findMany({
      where: { id: { in: [...ids] }, tenantId, doctorType, deletedAt: null },
      select: { id: true },
    });
    const foundIds = new Set(found.map((d) => d.id));
    for (const id of ids) {
      if (!foundIds.has(id)) {
        throw new InvalidPersonMappingReferenceException(mappingType, id);
      }
    }
  }

  /**
   * Shape a validated mapping DTO into a nested-create row, stamping the tenant.
   * `type` defaults to USER and `branchId` to null (tenant-level) when omitted.
   * @param tenantId tenant scope (set from context, never the body)
   * @param m the validated mapping
   */
  private toMappingCreate(
    tenantId: string,
    m: CategoryPersonMappingDto,
  ): Prisma.CategoryPersonMappingCreateWithoutCategoryInput {
    return {
      tenantId,
      personId: m.personId,
      type: m.type ?? PersonMappingType.USER,
      branchId: m.branchId ?? null,
      position: m.position,
      isSignatory: m.isSignatory ?? false,
      priority: m.priority,
      isDefault: m.isDefault ?? false,
    };
  }

  /**
   * Derive a category-code prefix from a tenant name: the first letter of up to
   * the first three words, uppercased, letters only (e.g. "Apex Bio Care" →
   * "ABC"). Falls back to "CAT" when the name has no letters.
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
    return initials.length > 0 ? initials : 'CAT';
  }

  /**
   * If the caught error is a Prisma unique-constraint violation (P2002), throw
   * the matching typed 409. Two user-set unique indexes exist (`name` and
   * `short_name`); the violated index name arrives in `error.meta.target`, so we
   * check `short_name` first (it contains `name` as a substring). Returns
   * normally for any other error so the caller can rethrow.
   * @param e the caught error
   * @param name the attempted name (for the conflict's context)
   * @param shortName the attempted shortName (for the conflict's context)
   * @throws CategoryShortNameConflictException / CategoryNameConflictException
   */
  private rethrowUniqueViolation(
    e: unknown,
    name: string,
    shortName: string,
  ): void {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== 'P2002'
    ) {
      return;
    }
    const target = String(
      (e.meta as { target?: string | string[] } | undefined)?.target ?? '',
    );
    if (target.includes('short_name')) {
      throw new CategoryShortNameConflictException(shortName);
    }
    throw new CategoryNameConflictException(name);
  }
}
