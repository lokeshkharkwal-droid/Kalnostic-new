import { Injectable } from '@nestjs/common';
import { Prisma, Radiologist } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateRadiologistDto } from './dto/create-radiologist.dto';
import { UpdateRadiologistDto } from './dto/update-radiologist.dto';
import { ListRadiologistsDto } from './dto/list-radiologists.dto';
import { RadiologistWithRefs } from './entities/radiologist.entity';
import {
  RadiologistDepartmentNotFoundException,
  RadiologistNotFoundException,
} from './exceptions/radiologist.exceptions';

/** Prisma `include` that resolves the department `{ id, name }` object. */
const WITH_DEPARTMENT = {
  department: { select: { id: true, name: true } },
} as const;

/**
 * Radiologist master-table management. Tenant-scoped + branch-level (CLAUDE.md
 * §4.5); Prisma-direct, no repository layer. Reads always filter
 * `{ tenantId, deletedAt: null }`; writes set tenant/branch from context and run
 * in `withTenant` transactions. Other modules (e.g. OrderModule) inject this
 * service to validate radiologist references.
 */
@Injectable()
export class RadiologistService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a radiologist in the caller's tenant/branch.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile; may be null for tenant-level)
   * @param dto validated payload
   * @returns the created radiologist with its resolved department
   * @throws RadiologistDepartmentNotFoundException if `departmentId` is invalid
   */
  async create(
    tenantId: string,
    branchId: string | null,
    dto: CreateRadiologistDto,
  ): Promise<RadiologistWithRefs> {
    await this.assertDepartment(tenantId, dto.departmentId);
    const created = await this.prisma.withTenant(tenantId, (tx) =>
      tx.radiologist.create({
        data: { ...dto, tenantId, branchId },
      }),
    );
    return this.findById(created.id, tenantId);
  }

  /**
   * Fetch one radiologist by id, scoped to the caller's tenant.
   * @param id radiologist id
   * @param tenantId tenant scope
   * @throws RadiologistNotFoundException if missing/soft-deleted/other tenant
   */
  async findById(id: string, tenantId: string): Promise<RadiologistWithRefs> {
    const row = await this.prisma.radiologist.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: WITH_DEPARTMENT,
    });
    if (!row) {
      throw new RadiologistNotFoundException(id);
    }
    return row;
  }

  /**
   * List radiologists in the caller's tenant (offset pagination). Supports
   * `search` (name/email/mobile) and a `departmentId` filter.
   * @param tenantId tenant scope
   * @param query search + filters + pagination
   */
  async findAll(
    tenantId: string,
    query: ListRadiologistsDto,
  ): Promise<PaginatedResult<RadiologistWithRefs>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.RadiologistWhereInput = { tenantId, deletedAt: null };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.departmentId) {
      where.departmentId = query.departmentId;
    }
    const [data, total] = await Promise.all([
      this.prisma.radiologist.findMany({
        where,
        include: WITH_DEPARTMENT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.radiologist.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Lightweight `{ id, name }` options for the Create-Order radiologist selector,
   * scoped to the caller's tenant **and active branch** (per CLAUDE.md §4.5).
   * Supports a case-insensitive `search` on the radiologist `name`.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param filters optional search + offset pagination
   * @returns full `{ id, name }[]` when `page` is omitted, else a paginated envelope
   */
  async findOptions(
    tenantId: string,
    branchId: string,
    filters: { search?: string; page?: number; limit?: number } = {},
  ): Promise<
    | Array<{ id: string; name: string }>
    | PaginatedResult<{ id: string; name: string }>
  > {
    const where: Prisma.RadiologistWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
    const term = filters.search?.trim();
    if (term) {
      where.name = { contains: term, mode: 'insensitive' };
    }

    const select = { id: true, name: true } as const;
    const orderBy = { name: 'asc' } as const;

    if (filters.page === undefined) {
      return this.prisma.radiologist.findMany({ where, select, orderBy });
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [data, total] = await Promise.all([
      this.prisma.radiologist.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.radiologist.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Update a radiologist (partial). Re-validates `departmentId` when supplied.
   * @param id radiologist id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws RadiologistNotFoundException / RadiologistDepartmentNotFoundException
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateRadiologistDto,
  ): Promise<RadiologistWithRefs> {
    await this.findById(id, tenantId);
    if (dto.departmentId !== undefined) {
      await this.assertDepartment(tenantId, dto.departmentId);
    }
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.radiologist.update({ where: { id }, data: dto }),
    );
    return this.findById(id, tenantId);
  }

  /**
   * Soft-delete a radiologist (sets `deletedAt`).
   * @param id radiologist id
   * @param tenantId tenant scope
   * @throws RadiologistNotFoundException if missing/soft-deleted/other tenant
   */
  async remove(id: string, tenantId: string): Promise<Radiologist> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.radiologist.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    );
  }

  /**
   * Assert a radiologist exists (active, same tenant). Used by OrderService to
   * validate a radiology-section reference.
   * @throws RadiologistNotFoundException if the id doesn't resolve
   */
  async assertExists(id: string, tenantId: string): Promise<void> {
    const row = await this.prisma.radiologist.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!row) {
      throw new RadiologistNotFoundException(id);
    }
  }

  /**
   * Validate that `departmentId` (when provided) references an active department
   * in the caller's tenant.
   * @throws RadiologistDepartmentNotFoundException if it doesn't resolve
   */
  private async assertDepartment(
    tenantId: string,
    departmentId?: string,
  ): Promise<void> {
    if (!departmentId) {
      return;
    }
    const dept = await this.prisma.department.findFirst({
      where: { id: departmentId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!dept) {
      throw new RadiologistDepartmentNotFoundException(departmentId);
    }
  }
}
