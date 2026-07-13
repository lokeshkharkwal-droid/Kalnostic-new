import { Injectable } from '@nestjs/common';
import { Phlebotomist, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreatePhlebotomistDto } from './dto/create-phlebotomist.dto';
import { UpdatePhlebotomistDto } from './dto/update-phlebotomist.dto';
import { ListPhlebotomistsDto } from './dto/list-phlebotomists.dto';
import { PhlebotomistNotFoundException } from './exceptions/phlebotomist.exceptions';

/**
 * Phlebotomist master-table management. Tenant-scoped + branch-level (CLAUDE.md
 * §4.5); Prisma-direct, no repository layer. Reads always filter
 * `{ tenantId, deletedAt: null }`; writes set tenant/branch from context and run
 * in `withTenant` transactions. Exported so `OrderModule` can validate
 * diagnostics-section references.
 */
@Injectable()
export class PhlebotomistService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /phlebotomists/options`). Tenant-scoped to non-deleted phlebotomists;
   * optionally filtered by `branchId` and a case-insensitive `name` search.
   * Returns the full array when `page` is omitted, or a paginated envelope when
   * `page` is supplied.
   * @param tenantId tenant scope
   * @param filters optional `branchId`, `search`, and opt-in `page`/`limit`
   * @returns the full `{ id, name }[]` array, or a paginated `{ data, total, page, limit }` envelope
   */
  async findOptions(
    tenantId: string,
    filters: {
      branchId?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<
    | Array<{ id: string; name: string }>
    | PaginatedResult<{ id: string; name: string }>
  > {
    const where: Prisma.PhlebotomistWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    const search = filters.search?.trim();
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const select = { id: true, name: true } as const;
    const orderBy = { name: 'asc' } as const;

    if (filters.page === undefined) {
      const rows = await this.prisma.phlebotomist.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.name }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.phlebotomist.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.phlebotomist.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: r.name })),
      total,
      page,
      limit,
    };
  }

  /**
   * Create a phlebotomist in the caller's tenant/branch.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile; may be null)
   * @param dto validated payload
   * @returns the created phlebotomist
   */
  async create(
    tenantId: string,
    branchId: string | null,
    dto: CreatePhlebotomistDto,
  ): Promise<Phlebotomist> {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.phlebotomist.create({ data: { ...dto, tenantId, branchId } }),
    );
  }

  /**
   * Fetch one phlebotomist by id, scoped to the caller's tenant.
   * @param id phlebotomist id
   * @param tenantId tenant scope
   * @throws PhlebotomistNotFoundException if missing/soft-deleted/other tenant
   */
  async findById(id: string, tenantId: string): Promise<Phlebotomist> {
    const row = await this.prisma.phlebotomist.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!row) {
      throw new PhlebotomistNotFoundException(id);
    }
    return row;
  }

  /**
   * List phlebotomists in the caller's tenant (offset pagination). Supports
   * `search` (name/email/mobile).
   * @param tenantId tenant scope
   * @param query search + pagination
   */
  async findAll(
    tenantId: string,
    query: ListPhlebotomistsDto,
  ): Promise<PaginatedResult<Phlebotomist>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PhlebotomistWhereInput = { tenantId, deletedAt: null };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.phlebotomist.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.phlebotomist.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Update a phlebotomist (partial).
   * @param id phlebotomist id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws PhlebotomistNotFoundException if missing/soft-deleted/other tenant
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdatePhlebotomistDto,
  ): Promise<Phlebotomist> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.phlebotomist.update({ where: { id }, data: dto }),
    );
  }

  /**
   * Soft-delete a phlebotomist (sets `deletedAt`).
   * @param id phlebotomist id
   * @param tenantId tenant scope
   * @throws PhlebotomistNotFoundException if missing/soft-deleted/other tenant
   */
  async remove(id: string, tenantId: string): Promise<Phlebotomist> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.phlebotomist.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    );
  }

  /**
   * Assert a phlebotomist exists (active, same tenant). Used by OrderService.
   * @throws PhlebotomistNotFoundException if the id doesn't resolve
   */
  async assertExists(id: string, tenantId: string): Promise<void> {
    const row = await this.prisma.phlebotomist.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!row) {
      throw new PhlebotomistNotFoundException(id);
    }
  }
}
