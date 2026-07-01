import { Injectable } from '@nestjs/common';
import {
  DataSource,
  DoctorType,
  PersonMappingType,
  Prisma,
  SubCategoryType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { DepartmentService } from '../department/department.service';
import { CategoryService } from '../category/category.service';
import { CreateSubCategoryDto } from './dto/create-sub-category.dto';
import { UpdateSubCategoryDto } from './dto/update-sub-category.dto';
import { CreateSubCategoryTemplateDto } from './dto/create-sub-category-template.dto';
import { UpdateSubCategoryTemplateDto } from './dto/update-sub-category-template.dto';
import { SubCategoryPersonMappingDto } from './dto/sub-category-person-mapping.dto';
import {
  SubCategoryEntity,
  SubCategoryWithMappings,
} from './entities/sub-category.entity';
import {
  DuplicateDefaultPositionException,
  IndependentSubCategoryParentException,
  InvalidPersonMappingReferenceException,
  InvalidSubCategoryPriorityException,
  PersonNotFoundException,
  SubCategoryCategoryRequiredException,
  SubCategoryDepartmentRequiredException,
  SubCategoryNameConflictException,
  SubCategoryNotFoundException,
  SubCategoryShortNameConflictException,
} from './exceptions/sub-category.exceptions';

/** The single SiteAdminCounter row id (schema `@default("global")`). */
const SITE_ADMIN_COUNTER_ID = 'global';

/** Eager-load active person mappings, ordered by priority. */
const MAPPINGS_INCLUDE = {
  personMappings: {
    where: { deletedAt: null },
    orderBy: { priority: 'asc' },
  },
} satisfies Prisma.SubCategoryInclude;

/** The resolved parent of a sub-category: at most one FK is non-null. */
interface ResolvedParent {
  departmentId: string | null;
  categoryId: string | null;
}

/**
 * Sub-category management. Tenant-scoped, tenant-level (CLAUDE.md §4.6). Mirrors
 * CategoryService, with a wider type dimension: a sub-category is INDEPENDENT
 * (no parent), UNDER_DEPARTMENT (linked to an active department of the same
 * tenant), or UNDER_CATEGORY (linked to an active category of the same tenant).
 * Every query carries `tenantId` (defence in depth on top of RLS, §4.3) and
 * filters soft-deleted rows.
 */
@Injectable()
export class SubCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departmentService: DepartmentService,
    private readonly categoryService: CategoryService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Create a sub-category in a tenant. The `code` is system-generated and
   * immutable: `{INITIALS}-SubCat-{n}`, where INITIALS are derived from the
   * tenant name and `n` is a 0-based per-tenant sequence taken by atomically
   * incrementing `Tenant.subCategoryCounter` in the same transaction (so
   * concurrent creates never collide). The parent link is resolved/validated
   * against `subCategoryType` first; person mappings (if any) are validated
   * before insert.
   * @param tenantId owning tenant
   * @param dto validated sub-category payload (no `code` — generated here)
   * @returns the created sub-category with its active person mappings
   * @throws SubCategoryDepartmentRequiredException / SubCategoryCategoryRequiredException
   *   / IndependentSubCategoryParentException if the type↔parent combination is invalid
   * @throws DepartmentNotFoundException / CategoryNotFoundException if the parent
   *   isn't an active record of this tenant
   * @throws SubCategoryNameConflictException if the name is already used by an
   *   active sub-category in this tenant
   * @throws SubCategoryShortNameConflictException if the shortName is already
   *   used by an active sub-category in the same scope (parent category/department,
   *   or per tenant for INDEPENDENT)
   * @throws InvalidSubCategoryPriorityException / DuplicateDefaultPositionException
   *   / PersonNotFoundException if the person mappings are invalid
   */
  async create(
    tenantId: string,
    dto: CreateSubCategoryDto,
  ): Promise<SubCategoryWithMappings> {
    const mappings = dto.personMappings ?? [];
    const parent = await this.resolveParentLink(
      tenantId,
      dto.subCategoryType,
      dto.departmentId,
      dto.categoryId,
    );
    // Validate any client-supplied branchIds against the tenant first (§4.7),
    // on the base client before opening the RLS transaction.
    await this.validateBranches(tenantId, mappings);
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { subCategoryCounter: { increment: 1 } },
          select: { subCategoryCounter: true, name: true },
        });
        // 0-based sequence: the first sub-category in a tenant is `…-SubCat-0`.
        // The counter is post-increment, so subtract 1 for this row's index.
        const sequence = tenant.subCategoryCounter - 1;
        const code = `${this.buildInitials(tenant.name)}-SubCat-${sequence}`;

        await this.validatePersonMappings(tx, tenantId, mappings);

        return tx.subCategory.create({
          data: {
            tenantId,
            name: dto.name,
            shortName: dto.shortName,
            description: dto.description ?? null,
            code,
            isActive: dto.isActive ?? true,
            subCategoryType: dto.subCategoryType,
            departmentId: parent.departmentId,
            categoryId: parent.categoryId,
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
   * Fetch one active sub-category scoped to its tenant, with active person
   * mappings.
   * @param id sub-category id
   * @param tenantId tenant scope
   * @throws SubCategoryNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<SubCategoryWithMappings> {
    const subCategory = await this.prisma.subCategory.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: MAPPINGS_INCLUDE,
    });
    if (!subCategory) {
      throw new SubCategoryNotFoundException(id);
    }
    return subCategory;
  }

  /**
   * List active sub-categories for a tenant (offset pagination), each with its
   * active person mappings.
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (matched against `name`
   *   or `code`), a `subCategoryType` filter, an active/inactive `status`
   *   filter, and cascading `departmentId` / `categoryId` filters
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
    filters: {
      search?: string;
      subCategoryType?: SubCategoryType;
      status?: 'ACTIVE' | 'INACTIVE';
      departmentId?: string;
      categoryId?: string;
    } = {},
  ): Promise<PaginatedResult<SubCategoryWithMappings>> {
    const where: Prisma.SubCategoryWhereInput = { tenantId, deletedAt: null };
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filters.subCategoryType) {
      where.subCategoryType = filters.subCategoryType;
    }
    if (filters.status) {
      where.isActive = filters.status === 'ACTIVE';
    }
    if (filters.departmentId) {
      where.departmentId = filters.departmentId;
    }
    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    }
    // Sequential (not array-`$transaction`) so each call flows through the RLS
    // extension and carries the tenant GUC when RLS is enabled.
    const data = await this.prisma.subCategory.findMany({
      where,
      include: MAPPINGS_INCLUDE,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.subCategory.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update a sub-category. `code` is immutable and never changes. When
   * `subCategoryType`, `departmentId`, or `categoryId` is supplied the resulting
   * parent link is re-resolved and re-validated (switching between INDEPENDENT,
   * UNDER_DEPARTMENT, and UNDER_CATEGORY is allowed). When `personMappings` is
   * supplied it REPLACES the whole set: existing active mappings are
   * soft-deleted and the new set is created (validated first), all inside one
   * transaction.
   * @param id sub-category id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws SubCategoryNotFoundException if missing/soft-deleted
   * @throws SubCategoryDepartmentRequiredException / SubCategoryCategoryRequiredException
   *   / IndependentSubCategoryParentException / DepartmentNotFoundException /
   *   CategoryNotFoundException if the new type↔parent combination is invalid
   * @throws SubCategoryNameConflictException on a name collision
   * @throws SubCategoryShortNameConflictException on a shortName collision in scope
   * @throws InvalidSubCategoryPriorityException / DuplicateDefaultPositionException
   *   / PersonNotFoundException if the replacement mappings are invalid
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateSubCategoryDto,
  ): Promise<SubCategoryWithMappings> {
    const existing = await this.findById(id, tenantId);

    // Re-resolve the parent link only when the caller touches a relevant field.
    let resolved: ResolvedParent | undefined;
    if (
      dto.subCategoryType !== undefined ||
      dto.departmentId !== undefined ||
      dto.categoryId !== undefined
    ) {
      const effectiveType = dto.subCategoryType ?? existing.subCategoryType;
      let candidateDept: string | undefined;
      let candidateCat: string | undefined;
      if (effectiveType === SubCategoryType.UNDER_DEPARTMENT) {
        candidateDept = dto.departmentId ?? existing.departmentId ?? undefined;
      } else if (effectiveType === SubCategoryType.UNDER_CATEGORY) {
        candidateCat = dto.categoryId ?? existing.categoryId ?? undefined;
      } else {
        // INDEPENDENT: any supplied id is rejected in resolveParentLink.
        candidateDept = dto.departmentId;
        candidateCat = dto.categoryId;
      }
      resolved = await this.resolveParentLink(
        tenantId,
        effectiveType,
        candidateDept,
        candidateCat,
      );
    }

    if (dto.personMappings !== undefined) {
      // Validate branchIds before the RLS transaction (§4.7), as in create().
      await this.validateBranches(tenantId, dto.personMappings);
    }

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const data: Prisma.SubCategoryUpdateInput = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.shortName !== undefined) data.shortName = dto.shortName;
        if (dto.description !== undefined) {
          data.description = dto.description ?? null;
        }
        if (dto.isActive !== undefined) data.isActive = dto.isActive;
        if (dto.moduleMapping !== undefined) {
          data.moduleMapping = dto.moduleMapping;
        }
        if (dto.subCategoryType !== undefined) {
          data.subCategoryType = dto.subCategoryType;
        }
        if (resolved !== undefined) {
          // Scalar FK writes (string | null) — connect or clear each parent.
          data.department =
            resolved.departmentId === null
              ? { disconnect: true }
              : { connect: { id: resolved.departmentId } };
          data.category =
            resolved.categoryId === null
              ? { disconnect: true }
              : { connect: { id: resolved.categoryId } };
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
          await tx.subCategoryPersonMapping.updateMany({
            where: { subCategoryId: id, tenantId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          data.personMappings = {
            create: dto.personMappings.map((m) =>
              this.toMappingCreate(tenantId, m),
            ),
          };
        }

        return tx.subCategory.update({
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
   * Soft-delete a sub-category and its active person mappings (sets `deletedAt`;
   * rows are preserved) in one transaction.
   * @param id sub-category id
   * @param tenantId tenant scope
   * @throws SubCategoryNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<SubCategoryWithMappings> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.subCategoryPersonMapping.updateMany({
        where: { subCategoryId: id, tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return tx.subCategory.update({
        where: { id },
        data: { deletedAt: new Date() },
        include: MAPPINGS_INCLUDE,
      });
    });
  }

  // ── Site Admin global templates ─────────────────────────────────────────────

  /**
   * Create a SITE_ADMIN global sub-category template (no tenant/branch, no person
   * mappings). For UNDER_DEPARTMENT / UNDER_CATEGORY the parent must reference a
   * SITE_ADMIN department / category template. The `code` is system-generated
   * `SA-SubCat-{n}` from the global `SiteAdminCounter`. Plain transaction (no GUC).
   * @param dto validated template payload (no `code` — generated here)
   * @returns the created template
   * @throws SubCategoryDepartmentRequiredException / SubCategoryCategoryRequiredException
   *   / IndependentSubCategoryParentException if the type↔parent combination is invalid
   * @throws DepartmentNotFoundException / CategoryNotFoundException if the parent
   *   isn't an active SITE_ADMIN template
   * @throws SubCategoryNameConflictException / SubCategoryShortNameConflictException on a clash
   */
  async createTemplate(
    dto: CreateSubCategoryTemplateDto,
  ): Promise<SubCategoryEntity> {
    const parent = await this.resolveTemplateParentLink(
      dto.subCategoryType,
      dto.departmentId,
      dto.categoryId,
    );
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const code = await this.mintTemplateCode(tx);
        const created = await tx.subCategory.create({
          data: {
            tenantId: null,
            source: DataSource.SITE_ADMIN,
            name: dto.name,
            shortName: dto.shortName,
            description: dto.description ?? null,
            code,
            isActive: dto.isActive ?? true,
            subCategoryType: dto.subCategoryType,
            departmentId: parent.departmentId,
            categoryId: parent.categoryId,
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
   * List active SITE_ADMIN sub-category templates (offset pagination).
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional `search` (name/code), `subCategoryType`, `status`,
   *   and cascading `departmentId` / `categoryId` filters
   */
  async findAllTemplates(
    page = 1,
    limit = 20,
    filters: {
      search?: string;
      subCategoryType?: SubCategoryType;
      status?: 'ACTIVE' | 'INACTIVE';
      departmentId?: string;
      categoryId?: string;
    } = {},
  ): Promise<PaginatedResult<SubCategoryEntity>> {
    const where: Prisma.SubCategoryWhereInput = {
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
    if (filters.subCategoryType) {
      where.subCategoryType = filters.subCategoryType;
    }
    if (filters.status) {
      where.isActive = filters.status === 'ACTIVE';
    }
    if (filters.departmentId) {
      where.departmentId = filters.departmentId;
    }
    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    }
    const data = await this.prisma.subCategory.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.subCategory.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active SITE_ADMIN sub-category template.
   * @param id template id
   * @throws SubCategoryNotFoundException if missing/soft-deleted/not a template
   */
  async findTemplateById(id: string): Promise<SubCategoryEntity> {
    const subCategory = await this.prisma.subCategory.findFirst({
      where: {
        id,
        source: DataSource.SITE_ADMIN,
        tenantId: null,
        deletedAt: null,
      },
    });
    if (!subCategory) {
      throw new SubCategoryNotFoundException(id);
    }
    return subCategory;
  }

  /**
   * Update a SITE_ADMIN sub-category template. `code` is immutable. When
   * `subCategoryType`/`departmentId`/`categoryId` is supplied the parent link is
   * re-resolved against SITE_ADMIN templates (switching between INDEPENDENT,
   * UNDER_DEPARTMENT, and UNDER_CATEGORY is allowed).
   * @param id template id
   * @param dto partial update
   * @throws SubCategoryNotFoundException if missing/soft-deleted/not a template
   * @throws SubCategoryDepartmentRequiredException / SubCategoryCategoryRequiredException
   *   / IndependentSubCategoryParentException / DepartmentNotFoundException /
   *   CategoryNotFoundException if the new type↔parent combination is invalid
   * @throws SubCategoryNameConflictException / SubCategoryShortNameConflictException on a clash
   */
  async updateTemplate(
    id: string,
    dto: UpdateSubCategoryTemplateDto,
  ): Promise<SubCategoryEntity> {
    const existing = await this.findTemplateById(id);
    let resolved: ResolvedParent | undefined;
    if (
      dto.subCategoryType !== undefined ||
      dto.departmentId !== undefined ||
      dto.categoryId !== undefined
    ) {
      const effectiveType = dto.subCategoryType ?? existing.subCategoryType;
      let candidateDept: string | undefined;
      let candidateCat: string | undefined;
      if (effectiveType === SubCategoryType.UNDER_DEPARTMENT) {
        candidateDept = dto.departmentId ?? existing.departmentId ?? undefined;
      } else if (effectiveType === SubCategoryType.UNDER_CATEGORY) {
        candidateCat = dto.categoryId ?? existing.categoryId ?? undefined;
      } else {
        candidateDept = dto.departmentId;
        candidateCat = dto.categoryId;
      }
      resolved = await this.resolveTemplateParentLink(
        effectiveType,
        candidateDept,
        candidateCat,
      );
    }
    const data: Prisma.SubCategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.shortName !== undefined) data.shortName = dto.shortName;
    if (dto.description !== undefined)
      data.description = dto.description ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.moduleMapping !== undefined) data.moduleMapping = dto.moduleMapping;
    if (dto.subCategoryType !== undefined) {
      data.subCategoryType = dto.subCategoryType;
    }
    if (resolved !== undefined) {
      data.department =
        resolved.departmentId === null
          ? { disconnect: true }
          : { connect: { id: resolved.departmentId } };
      data.category =
        resolved.categoryId === null
          ? { disconnect: true }
          : { connect: { id: resolved.categoryId } };
    }
    try {
      return await this.prisma.subCategory.update({ where: { id }, data });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name ?? '', dto.shortName ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a SITE_ADMIN sub-category template (sets `deletedAt`).
   * @param id template id
   * @throws SubCategoryNotFoundException if missing/soft-deleted/not a template
   */
  async removeTemplate(id: string): Promise<SubCategoryEntity> {
    await this.findTemplateById(id);
    return this.prisma.subCategory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Clone / adoption (SITE_ADMIN template → tenant) ──────────────────────────

  /**
   * Adopt a SITE_ADMIN sub-category template into the caller's tenant catalogue,
   * cascade-cloning its parent template chain: UNDER_CATEGORY → clones the parent
   * category (which clones its own parent department), UNDER_DEPARTMENT → clones
   * the parent department. A fresh tenant `code` is minted. Idempotent: any
   * template already cloned into the tenant is reused, not duplicated. Fully
   * transactional.
   * @param templateId the SITE_ADMIN template to clone
   * @param tenantId caller's tenant
   * @returns the tenant sub-category (existing clone or newly created)
   * @throws SubCategoryNotFoundException if `templateId` is not a live template
   * @throws DepartmentNotFoundException / CategoryNotFoundException if a parent
   *   template is gone
   * @throws SubCategoryNameConflictException / SubCategoryShortNameConflictException on a clash
   */
  async cloneToTenant(
    templateId: string,
    tenantId: string,
  ): Promise<SubCategoryWithMappings> {
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
   * Clone a SITE_ADMIN sub-category template into a tenant within an EXISTING
   * transaction. Reuses an existing clone (matched by `clonedFromId`) when
   * present, and cascade-clones the parent category template (UNDER_CATEGORY) or
   * department template (UNDER_DEPARTMENT). The new row is `source = TENANT` with
   * a fresh tenant `code` and `clonedFromId` set; no person mappings.
   * @param tx the caller's transaction client (already in `withTenant`)
   * @param templateId the SITE_ADMIN template sub-category to clone
   * @param tenantId target tenant
   * @returns the tenant sub-category (existing clone or newly created)
   * @throws SubCategoryNotFoundException if `templateId` is not a live template
   */
  async cloneTemplateWithinTx(
    tx: Prisma.TransactionClient,
    templateId: string,
    tenantId: string,
  ): Promise<SubCategoryEntity> {
    const existing = await tx.subCategory.findFirst({
      where: { tenantId, clonedFromId: templateId, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    const template = await tx.subCategory.findFirst({
      where: {
        id: templateId,
        source: DataSource.SITE_ADMIN,
        tenantId: null,
        deletedAt: null,
      },
    });
    if (!template) {
      throw new SubCategoryNotFoundException(templateId);
    }
    let departmentId: string | null = null;
    let categoryId: string | null = null;
    if (
      template.subCategoryType === SubCategoryType.UNDER_DEPARTMENT &&
      template.departmentId
    ) {
      const clonedDept = await this.departmentService.cloneTemplateWithinTx(
        tx,
        template.departmentId,
        tenantId,
      );
      departmentId = clonedDept.id;
    } else if (
      template.subCategoryType === SubCategoryType.UNDER_CATEGORY &&
      template.categoryId
    ) {
      const clonedCat = await this.categoryService.cloneTemplateWithinTx(
        tx,
        template.categoryId,
        tenantId,
      );
      categoryId = clonedCat.id;
    }
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { subCategoryCounter: { increment: 1 } },
      select: { subCategoryCounter: true, name: true },
    });
    const code = `${this.buildInitials(tenant.name)}-SubCat-${tenant.subCategoryCounter - 1}`;
    return tx.subCategory.create({
      data: {
        tenantId,
        source: DataSource.TENANT,
        clonedFromId: templateId,
        name: template.name,
        shortName: template.shortName,
        description: template.description,
        code,
        isActive: template.isActive,
        subCategoryType: template.subCategoryType,
        departmentId,
        categoryId,
        moduleMapping: template.moduleMapping,
      },
    });
  }

  /**
   * Resolve/validate the parent link for a TEMPLATE sub-category (mirrors
   * `resolveParentLink` but validates against SITE_ADMIN templates):
   * INDEPENDENT → both null; UNDER_DEPARTMENT → an active SITE_ADMIN department
   * template; UNDER_CATEGORY → an active SITE_ADMIN category template.
   * @param subCategoryType the (effective) sub-category type
   * @param departmentId the candidate template department id, if any
   * @param categoryId the candidate template category id, if any
   * @throws IndependentSubCategoryParentException / SubCategoryDepartmentRequiredException
   *   / SubCategoryCategoryRequiredException / DepartmentNotFoundException /
   *   CategoryNotFoundException
   */
  private async resolveTemplateParentLink(
    subCategoryType: SubCategoryType,
    departmentId: string | undefined,
    categoryId: string | undefined,
  ): Promise<ResolvedParent> {
    if (subCategoryType === SubCategoryType.INDEPENDENT) {
      if (departmentId || categoryId) {
        throw new IndependentSubCategoryParentException();
      }
      return { departmentId: null, categoryId: null };
    }
    if (subCategoryType === SubCategoryType.UNDER_DEPARTMENT) {
      if (!departmentId) {
        throw new SubCategoryDepartmentRequiredException();
      }
      // Throws DepartmentNotFoundException if it isn't an active SITE_ADMIN template.
      await this.departmentService.findTemplateById(departmentId);
      return { departmentId, categoryId: null };
    }
    // UNDER_CATEGORY
    if (!categoryId) {
      throw new SubCategoryCategoryRequiredException();
    }
    // Throws CategoryNotFoundException if it isn't an active SITE_ADMIN template.
    await this.categoryService.findTemplateById(categoryId);
    return { departmentId: null, categoryId };
  }

  /**
   * Take the next global template sequence from the `SiteAdminCounter` singleton
   * (upserting on first use) and format `SA-SubCat-{n}` (0-based, post-increment).
   * @param tx active transaction client
   */
  private async mintTemplateCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const counter = await tx.siteAdminCounter.upsert({
      where: { id: SITE_ADMIN_COUNTER_ID },
      create: { id: SITE_ADMIN_COUNTER_ID, subCategoryCounter: 1 },
      update: { subCategoryCounter: { increment: 1 } },
      select: { subCategoryCounter: true },
    });
    return `SA-SubCat-${counter.subCategoryCounter - 1}`;
  }

  /**
   * Resolve and validate the parent link implied by `subCategoryType`:
   *  - INDEPENDENT → must have no `departmentId`/`categoryId` (else throws);
   *    returns both null.
   *  - UNDER_DEPARTMENT → `departmentId` is required and must be an active
   *    department of this tenant (verified via DepartmentService.findById, which
   *    throws DepartmentNotFoundException otherwise); returns that id, category null.
   *  - UNDER_CATEGORY → `categoryId` is required and must be an active category
   *    of this tenant (verified via CategoryService.findById, which throws
   *    CategoryNotFoundException otherwise); returns that id, department null.
   * @param tenantId tenant scope
   * @param subCategoryType the (effective) sub-category type
   * @param departmentId the candidate department id, if any
   * @param categoryId the candidate category id, if any
   * @returns the parent ids to persist (exactly one non-null, or both null)
   * @throws IndependentSubCategoryParentException / SubCategoryDepartmentRequiredException
   *   / SubCategoryCategoryRequiredException / DepartmentNotFoundException /
   *   CategoryNotFoundException
   */
  private async resolveParentLink(
    tenantId: string,
    subCategoryType: SubCategoryType,
    departmentId: string | undefined,
    categoryId: string | undefined,
  ): Promise<ResolvedParent> {
    if (subCategoryType === SubCategoryType.INDEPENDENT) {
      if (departmentId || categoryId) {
        throw new IndependentSubCategoryParentException();
      }
      return { departmentId: null, categoryId: null };
    }
    if (subCategoryType === SubCategoryType.UNDER_DEPARTMENT) {
      if (!departmentId) {
        throw new SubCategoryDepartmentRequiredException();
      }
      // Throws DepartmentNotFoundException if it isn't an active dept of the tenant.
      await this.departmentService.findById(departmentId, tenantId);
      return { departmentId, categoryId: null };
    }
    // UNDER_CATEGORY
    if (!categoryId) {
      throw new SubCategoryCategoryRequiredException();
    }
    // Throws CategoryNotFoundException if it isn't an active category of the tenant.
    await this.categoryService.findById(categoryId, tenantId);
    return { departmentId: null, categoryId };
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
    mappings: SubCategoryPersonMappingDto[],
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
   * own group), so one sub-category can hold different personnel per branch:
   *  - at most one `isDefault` mapping per (branch, position) in the incoming set;
   *  - each `priority` is in `[1, max]`, where `max` is, for that mapping's
   *    branch, the tenant's active mappings for the same branch (outside this
   *    sub-category) plus the incoming rows for that branch;
   *  - every referenced party exists and is active in the table its `type`
   *    resolves to.
   * @param tx active tenant transaction client
   * @param tenantId tenant scope
   * @param mappings incoming mappings
   * @param excludeSubCategoryId sub-category whose existing rows are being
   *   replaced (omitted on create)
   * @throws DuplicateDefaultPositionException / InvalidSubCategoryPriorityException
   *   / PersonNotFoundException / InvalidPersonMappingReferenceException
   */
  private async validatePersonMappings(
    tx: Prisma.TransactionClient,
    tenantId: string,
    mappings: SubCategoryPersonMappingDto[],
    excludeSubCategoryId?: string,
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
    // (outside this sub-category) + the incoming rows for that branch.
    const incomingByBranch = new Map<
      string | null,
      SubCategoryPersonMappingDto[]
    >();
    for (const m of mappings) {
      const branchKey = m.branchId ?? null;
      const group = incomingByBranch.get(branchKey) ?? [];
      group.push(m);
      incomingByBranch.set(branchKey, group);
    }
    for (const [branchId, group] of incomingByBranch) {
      const existing = await tx.subCategoryPersonMapping.count({
        where: {
          tenantId,
          branchId,
          deletedAt: null,
          ...(excludeSubCategoryId
            ? { subCategoryId: { not: excludeSubCategoryId } }
            : {}),
        },
      });
      const max = existing + group.length;
      for (const m of group) {
        if (m.priority < 1 || m.priority > max) {
          throw new InvalidSubCategoryPriorityException(m.priority, max);
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
    mappings: SubCategoryPersonMappingDto[],
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
    m: SubCategoryPersonMappingDto,
  ): Prisma.SubCategoryPersonMappingCreateWithoutSubCategoryInput {
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
   * Derive a sub-category-code prefix from a tenant name: the first letter of up
   * to the first three words, uppercased, letters only (e.g. "Apex Bio Care" →
   * "ABC"). Falls back to "SUB" when the name has no letters.
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
    return initials.length > 0 ? initials : 'SUB';
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
   * @throws SubCategoryShortNameConflictException / SubCategoryNameConflictException
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
      throw new SubCategoryShortNameConflictException(shortName);
    }
    throw new SubCategoryNameConflictException(name);
  }
}
