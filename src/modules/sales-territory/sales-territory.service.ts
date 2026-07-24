import { Injectable } from '@nestjs/common';
import { Prisma, SalesTerritory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateSalesTerritoryDto } from './dto/create-sales-territory.dto';
import { UpdateSalesTerritoryDto } from './dto/update-sales-territory.dto';
import { ListSalesTerritoriesDto } from './dto/list-sales-territories.dto';
import {
  InvalidSalesTerritoriesException,
  SalesTerritoryNameConflictException,
  SalesTerritoryNotFoundException,
} from './exceptions/sales-territory.exceptions';

/**
 * Sales territory (zone) master. Tenant-scoped + branch-level (CLAUDE.md §4.7):
 * every query carries `tenantId` + `branchId` and filters soft-deleted rows.
 * Territories populate the "Territory / Zone" dropdown and filter on leads.
 */
@Injectable()
export class SalesTerritoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List the active branch's territories (paginated). Supports a case-
   * insensitive `search` on name/code and an active `status` filter.
   * @param tenantId tenant scope
   * @param branchId active branch scope
   * @param query pagination + search + status filters
   */
  async findAll(
    tenantId: string,
    branchId: string,
    query: ListSalesTerritoriesDto,
  ): Promise<PaginatedResult<SalesTerritory>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.SalesTerritoryWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
    const term = query.search?.trim();
    if (term) {
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { code: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.isActive = query.status === 'ACTIVE';
    }
    const [data, total] = await Promise.all([
      this.prisma.salesTerritory.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.salesTerritory.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Active `{ id, name }` options for the Territory/Zone dropdown at the branch.
   * @param tenantId tenant scope
   * @param branchId active branch scope
   */
  async options(
    tenantId: string,
    branchId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.salesTerritory.findMany({
      where: { tenantId, branchId, deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Fetch one territory scoped to tenant + branch.
   * @throws SalesTerritoryNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<SalesTerritory> {
    const territory = await this.prisma.salesTerritory.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!territory) {
      throw new SalesTerritoryNotFoundException(id);
    }
    return territory;
  }

  /**
   * Validate that every id in `territoryIds` is an active territory at the
   * branch (used when a lead references a territory).
   * @throws InvalidSalesTerritoriesException listing the offending ids
   */
  async assertValidTerritories(
    tenantId: string,
    branchId: string,
    territoryIds: string[],
  ): Promise<void> {
    if (territoryIds.length === 0) return;
    const found = await this.prisma.salesTerritory.findMany({
      where: { id: { in: territoryIds }, tenantId, branchId, deletedAt: null },
      select: { id: true },
    });
    const foundSet = new Set(found.map((t) => t.id));
    const invalid = territoryIds.filter((id) => !foundSet.has(id));
    if (invalid.length > 0) {
      throw new InvalidSalesTerritoriesException(invalid);
    }
  }

  /**
   * Create a territory at the active branch.
   * @throws SalesTerritoryNameConflictException on a duplicate active name
   */
  async create(
    tenantId: string,
    branchId: string,
    dto: CreateSalesTerritoryDto,
    actorId?: string,
  ): Promise<SalesTerritory> {
    await this.assertNameFree(tenantId, branchId, dto.name);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.salesTerritory.create({
        data: {
          tenantId,
          branchId,
          name: dto.name,
          code: dto.code ?? null,
          isActive: dto.isActive ?? true,
          createdBy: actorId ?? null,
          updatedBy: actorId ?? null,
        },
      }),
    );
  }

  /**
   * Update a territory.
   * @throws SalesTerritoryNotFoundException / SalesTerritoryNameConflictException
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    dto: UpdateSalesTerritoryDto,
    actorId?: string,
  ): Promise<SalesTerritory> {
    const existing = await this.findById(id, tenantId, branchId);
    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameFree(tenantId, branchId, dto.name, id);
    }
    const data: Prisma.SalesTerritoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (actorId !== undefined) data.updatedBy = actorId;
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.salesTerritory.update({ where: { id }, data }),
    );
  }

  /**
   * Soft-delete a territory.
   * @throws SalesTerritoryNotFoundException if missing
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<SalesTerritory> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.salesTerritory.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    );
  }

  /** Reject a duplicate active territory name at the branch. */
  private async assertNameFree(
    tenantId: string,
    branchId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await this.prisma.salesTerritory.findFirst({
      where: {
        tenantId,
        branchId,
        name,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (conflict) {
      throw new SalesTerritoryNameConflictException(name);
    }
  }
}
