import { Injectable } from '@nestjs/common';
import { Branch, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BranchNotFoundException } from './exceptions/branch.exceptions';

/**
 * Branch management. Tenant-scoped: every query carries `tenantId` (defence in
 * depth on top of RLS — CLAUDE.md §4.3) and filters soft-deleted rows.
 */
@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a branch within a tenant.
   * @param tenantId owning tenant
   * @param dto validated branch payload
   * @returns the created branch
   */
  async create(tenantId: string, dto: CreateBranchDto): Promise<Branch> {
    return this.prisma.branch.create({
      data: {
        tenantId,
        name: dto.name,
        branchType: dto.branchType,
        code: dto.code ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: (dto.address ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Fetch one active branch scoped to its tenant.
   * @param id branch id
   * @param tenantId tenant scope
   * @throws BranchNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<Branch> {
    const branch = await this.prisma.branch.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!branch) {
      throw new BranchNotFoundException(id);
    }
    return branch;
  }

  /**
   * List active branches for a tenant (offset pagination).
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<Branch>> {
    const where = { tenantId, deletedAt: null };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.branch.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Update an existing branch.
   * @param id branch id
   * @param tenantId tenant scope
   * @param dto partial update
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateBranchDto,
  ): Promise<Branch> {
    await this.findById(id, tenantId);
    const data: Prisma.BranchUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.branchType !== undefined) data.branchType = dto.branchType;
    if (dto.code !== undefined) data.code = dto.code ?? null;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.address !== undefined) {
      data.address = (dto.address ?? Prisma.JsonNull) as Prisma.InputJsonValue;
    }
    return this.prisma.branch.update({ where: { id }, data });
  }

  /**
   * Soft-delete a branch (sets deletedAt; row is preserved).
   * @param id branch id
   * @param tenantId tenant scope
   */
  async remove(id: string, tenantId: string): Promise<Branch> {
    await this.findById(id, tenantId);
    return this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
