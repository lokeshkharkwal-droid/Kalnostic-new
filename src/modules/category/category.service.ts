import { Injectable } from '@nestjs/common';
import { CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { DepartmentService } from '../department/department.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryPersonMappingDto } from './dto/category-person-mapping.dto';
import { CategoryWithMappings } from './entities/category.entity';
import {
  CategoryDepartmentRequiredException,
  CategoryNameConflictException,
  CategoryNotFoundException,
  CategoryShortNameConflictException,
  DuplicateDefaultPositionException,
  IndependentCategoryDepartmentException,
  InvalidCategoryPriorityException,
  PersonNotFoundException,
} from './exceptions/category.exceptions';

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
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<CategoryWithMappings>> {
    const where = { tenantId, deletedAt: null };
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
   * Validate a set of person mappings before persisting (CLAUDE.md rule #2 —
   * the dynamic checks here can't be expressed with class-validator):
   *  - at most one `isDefault` mapping per position in the incoming set;
   *  - each `priority` is in `[1, max]`, where `max` is the tenant's total
   *    active person-mapping count after this write — existing rows outside this
   *    category, plus the incoming rows (rows of `excludeCategoryId` are being
   *    replaced, so they don't count toward the base);
   *  - every referenced person exists and is active.
   * @param tx active tenant transaction client
   * @param tenantId tenant scope
   * @param mappings incoming mappings
   * @param excludeCategoryId category whose existing rows are being replaced
   *   (omitted on create)
   * @throws DuplicateDefaultPositionException / InvalidCategoryPriorityException
   *   / PersonNotFoundException
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

    // Priority cap = tenant's active mappings outside this category + incoming.
    const existing = await tx.categoryPersonMapping.count({
      where: {
        tenantId,
        deletedAt: null,
        ...(excludeCategoryId
          ? { categoryId: { not: excludeCategoryId } }
          : {}),
      },
    });
    const max = existing + mappings.length;
    for (const m of mappings) {
      if (m.priority < 1 || m.priority > max) {
        throw new InvalidCategoryPriorityException(m.priority, max);
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
    m: CategoryPersonMappingDto,
  ): Prisma.CategoryPersonMappingCreateWithoutCategoryInput {
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
