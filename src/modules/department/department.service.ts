import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { DepartmentPersonMappingDto } from './dto/department-person-mapping.dto';
import { DepartmentWithMappings } from './entities/department.entity';
import {
  DepartmentNameConflictException,
  DepartmentNotFoundException,
  DepartmentShortNameConflictException,
  DuplicateDefaultPositionException,
  InvalidDepartmentPriorityException,
  PersonNotFoundException,
} from './exceptions/department.exceptions';

/** Eager-load active person mappings, ordered by priority. */
const MAPPINGS_INCLUDE = {
  personMappings: {
    where: { deletedAt: null },
    orderBy: { priority: 'asc' },
  },
} satisfies Prisma.DepartmentInclude;

/**
 * Department management. Tenant-scoped, tenant-level (no branch — CLAUDE.md
 * §4.6). Every query carries `tenantId` (defence in depth on top of RLS,
 * §4.3) and filters soft-deleted rows.
 */
@Injectable()
export class DepartmentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a department in a tenant. The `code` is system-generated and
   * immutable: `{INITIALS}-Dep-{n}`, where INITIALS are derived from the tenant
   * name and `n` is a 0-based per-tenant sequence taken by atomically
   * incrementing `Tenant.departmentCounter` in the same transaction (so
   * concurrent creates never collide). Person mappings (if any) are validated
   * before insert.
   * @param tenantId owning tenant
   * @param dto validated department payload (no `code` — generated here)
   * @returns the created department with its active person mappings
   * @throws DepartmentNameConflictException if the name is already used by an
   *   active department in this tenant
   * @throws DepartmentShortNameConflictException if the shortName is already
   *   used by an active department in this tenant
   * @throws InvalidDepartmentPriorityException / DuplicateDefaultPositionException
   *   / PersonNotFoundException if the person mappings are invalid
   */
  async create(
    tenantId: string,
    dto: CreateDepartmentDto,
  ): Promise<DepartmentWithMappings> {
    const mappings = dto.personMappings ?? [];
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { departmentCounter: { increment: 1 } },
          select: { departmentCounter: true, name: true },
        });
        // 0-based sequence: the first department in a tenant is `…-Dep-0`. The
        // counter is post-increment, so subtract 1 for this department's index.
        const sequence = tenant.departmentCounter - 1;
        const code = `${this.buildInitials(tenant.name)}-Dep-${sequence}`;

        await this.validatePersonMappings(tx, tenantId, mappings);

        return tx.department.create({
          data: {
            tenantId,
            name: dto.name,
            shortName: dto.shortName,
            description: dto.description ?? null,
            code,
            isActive: dto.isActive ?? true,
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
   * Fetch one active department scoped to its tenant, with active person
   * mappings.
   * @param id department id
   * @param tenantId tenant scope
   * @throws DepartmentNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<DepartmentWithMappings> {
    const department = await this.prisma.department.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: MAPPINGS_INCLUDE,
    });
    if (!department) {
      throw new DepartmentNotFoundException(id);
    }
    return department;
  }

  /**
   * List active departments for a tenant (offset pagination), each with its
   * active person mappings.
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<DepartmentWithMappings>> {
    const where = { tenantId, deletedAt: null };
    // Sequential (not array-`$transaction`) so each call flows through the RLS
    // extension and carries the tenant GUC when RLS is enabled.
    const data = await this.prisma.department.findMany({
      where,
      include: MAPPINGS_INCLUDE,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.department.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update a department. `code` is immutable and never changes. When
   * `personMappings` is supplied it REPLACES the whole set: existing active
   * mappings are soft-deleted and the new set is created (validated first), all
   * inside one transaction.
   * @param id department id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws DepartmentNotFoundException if missing/soft-deleted
   * @throws DepartmentNameConflictException on a name collision
   * @throws DepartmentShortNameConflictException on a shortName collision
   * @throws InvalidDepartmentPriorityException / DuplicateDefaultPositionException
   *   / PersonNotFoundException if the replacement mappings are invalid
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateDepartmentDto,
  ): Promise<DepartmentWithMappings> {
    await this.findById(id, tenantId);
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const data: Prisma.DepartmentUpdateInput = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.shortName !== undefined) data.shortName = dto.shortName;
        if (dto.description !== undefined) {
          data.description = dto.description ?? null;
        }
        if (dto.isActive !== undefined) data.isActive = dto.isActive;
        if (dto.moduleMapping !== undefined) {
          data.moduleMapping = dto.moduleMapping;
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
          await tx.departmentPersonMapping.updateMany({
            where: { departmentId: id, tenantId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          data.personMappings = {
            create: dto.personMappings.map((m) =>
              this.toMappingCreate(tenantId, m),
            ),
          };
        }

        return tx.department.update({
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
   * Soft-delete a department and its active person mappings (sets `deletedAt`;
   * rows are preserved) in one transaction.
   * @param id department id
   * @param tenantId tenant scope
   * @throws DepartmentNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<DepartmentWithMappings> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.departmentPersonMapping.updateMany({
        where: { departmentId: id, tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return tx.department.update({
        where: { id },
        data: { deletedAt: new Date() },
        include: MAPPINGS_INCLUDE,
      });
    });
  }

  /**
   * Validate a set of person mappings before persisting (CLAUDE.md rule #2 —
   * the dynamic checks here can't be expressed with class-validator):
   *  - at most one `isDefault` mapping per position in the incoming set;
   *  - each `priority` is in `[1, max]`, where `max` is the tenant's total
   *    active person-mapping count after this write — existing rows outside this
   *    department, plus the incoming rows (rows of `excludeDepartmentId` are
   *    being replaced, so they don't count toward the base);
   *  - every referenced person exists and is active.
   * @param tx active tenant transaction client
   * @param tenantId tenant scope
   * @param mappings incoming mappings
   * @param excludeDepartmentId department whose existing rows are being replaced
   *   (omitted on create)
   * @throws DuplicateDefaultPositionException / InvalidDepartmentPriorityException
   *   / PersonNotFoundException
   */
  private async validatePersonMappings(
    tx: Prisma.TransactionClient,
    tenantId: string,
    mappings: DepartmentPersonMappingDto[],
    excludeDepartmentId?: string,
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

    // Priority cap = tenant's active mappings outside this department + incoming.
    const existing = await tx.departmentPersonMapping.count({
      where: {
        tenantId,
        deletedAt: null,
        ...(excludeDepartmentId
          ? { departmentId: { not: excludeDepartmentId } }
          : {}),
      },
    });
    const max = existing + mappings.length;
    for (const m of mappings) {
      if (m.priority < 1 || m.priority > max) {
        throw new InvalidDepartmentPriorityException(m.priority, max);
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
    m: DepartmentPersonMappingDto,
  ): Prisma.DepartmentPersonMappingCreateWithoutDepartmentInput {
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
   * Derive a department-code prefix from a tenant name: the first letter of up
   * to the first three words, uppercased, letters only (e.g. "Apex Bio Care" →
   * "ABC"). Falls back to "DEP" when the name has no letters.
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
    return initials.length > 0 ? initials : 'DEP';
  }

  /**
   * If the caught error is a Prisma unique-constraint violation (P2002), throw
   * the matching typed 409. Two user-set unique indexes exist per tenant
   * (`name` and `short_name`); the violated index name arrives in
   * `error.meta.target`, so we check `short_name` first (it contains `name` as a
   * substring). Returns normally for any other error so the caller can rethrow.
   * @param e the caught error
   * @param name the attempted name (for the conflict's context)
   * @param shortName the attempted shortName (for the conflict's context)
   * @throws DepartmentShortNameConflictException / DepartmentNameConflictException
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
      throw new DepartmentShortNameConflictException(shortName);
    }
    throw new DepartmentNameConflictException(name);
  }
}
