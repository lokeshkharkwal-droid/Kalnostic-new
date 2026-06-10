import { Injectable } from '@nestjs/common';
import { Prisma, SubCategoryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { DepartmentService } from '../department/department.service';
import { CategoryService } from '../category/category.service';
import { CreateSubCategoryDto } from './dto/create-sub-category.dto';
import { UpdateSubCategoryDto } from './dto/update-sub-category.dto';
import { SubCategoryPersonMappingDto } from './dto/sub-category-person-mapping.dto';
import { SubCategoryWithMappings } from './entities/sub-category.entity';
import {
  DuplicateDefaultPositionException,
  IndependentSubCategoryParentException,
  InvalidSubCategoryPriorityException,
  PersonNotFoundException,
  SubCategoryCategoryRequiredException,
  SubCategoryDepartmentRequiredException,
  SubCategoryNameConflictException,
  SubCategoryNotFoundException,
  SubCategoryShortNameConflictException,
} from './exceptions/sub-category.exceptions';

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
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<SubCategoryWithMappings>> {
    const where = { tenantId, deletedAt: null };
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
   * Validate a set of person mappings before persisting (CLAUDE.md rule #2 —
   * the dynamic checks here can't be expressed with class-validator):
   *  - at most one `isDefault` mapping per position in the incoming set;
   *  - each `priority` is in `[1, max]`, where `max` is the tenant's total
   *    active person-mapping count after this write — existing rows outside this
   *    sub-category, plus the incoming rows (rows of `excludeSubCategoryId` are
   *    being replaced, so they don't count toward the base);
   *  - every referenced person exists and is active.
   * @param tx active tenant transaction client
   * @param tenantId tenant scope
   * @param mappings incoming mappings
   * @param excludeSubCategoryId sub-category whose existing rows are being
   *   replaced (omitted on create)
   * @throws DuplicateDefaultPositionException / InvalidSubCategoryPriorityException
   *   / PersonNotFoundException
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

    // At most one default per position in the incoming set.
    const defaultsByPosition = new Map<string, number>();
    for (const m of mappings) {
      if (m.isDefault) {
        const count = (defaultsByPosition.get(m.position) ?? 0) + 1;
        if (count > 1) {
          throw new DuplicateDefaultPositionException(m.position);
        }
        defaultsByPosition.set(m.position, count);
      }
    }

    // Priority cap = tenant's active mappings outside this sub-category + incoming.
    const existing = await tx.subCategoryPersonMapping.count({
      where: {
        tenantId,
        deletedAt: null,
        ...(excludeSubCategoryId
          ? { subCategoryId: { not: excludeSubCategoryId } }
          : {}),
      },
    });
    const max = existing + mappings.length;
    for (const m of mappings) {
      if (m.priority < 1 || m.priority > max) {
        throw new InvalidSubCategoryPriorityException(m.priority, max);
      }
    }

    // Every referenced person must exist and be active.
    const personIds = [...new Set(mappings.map((m) => m.personId))];
    const found = await tx.person.findMany({
      where: { id: { in: personIds }, deletedAt: null },
      select: { id: true },
    });
    const foundIds = new Set(found.map((p) => p.id));
    for (const personId of personIds) {
      if (!foundIds.has(personId)) {
        throw new PersonNotFoundException(personId);
      }
    }
  }

  /**
   * Shape a validated mapping DTO into a nested-create row, stamping the tenant.
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
      (e.meta as { target?: unknown } | undefined)?.target ?? '',
    );
    if (target.includes('short_name')) {
      throw new SubCategoryShortNameConflictException(shortName);
    }
    throw new SubCategoryNameConflictException(name);
  }
}
