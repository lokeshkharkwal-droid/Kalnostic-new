import { Injectable } from '@nestjs/common';
import { Prisma, ServiceZone } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateServiceZoneDto } from './dto/create-service-zone.dto';
import { UpdateServiceZoneDto } from './dto/update-service-zone.dto';
import { ListServiceZonesDto } from './dto/list-service-zones.dto';
import {
  InvalidServiceZonesException,
  ServiceZoneNameConflictException,
  ServiceZoneNotFoundException,
} from './exceptions/phlebotomist-schedule.exceptions';

/**
 * Service-area (zone) master. Tenant-scoped + branch-level (CLAUDE.md §4.7):
 * every query carries `tenantId` + `branchId` and filters soft-deleted rows.
 * Zones populate the "Area / Zone" dropdown and are attached to phlebotomist
 * schedules (many-to-many).
 */
@Injectable()
export class ServiceZoneService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List the active branch's service zones (paginated). Supports a case-
   * insensitive `search` on name/code and an active `status` filter.
   */
  async findAll(
    tenantId: string,
    branchId: string,
    query: ListServiceZonesDto,
  ): Promise<PaginatedResult<ServiceZone>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ServiceZoneWhereInput = {
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
      this.prisma.serviceZone.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.serviceZone.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Active `{ id, name }` options for the Area/Zone dropdown at the active branch.
   */
  async options(
    tenantId: string,
    branchId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.serviceZone.findMany({
      where: { tenantId, branchId, deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Fetch one zone scoped to tenant + branch.
   * @throws ServiceZoneNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<ServiceZone> {
    const zone = await this.prisma.serviceZone.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!zone) {
      throw new ServiceZoneNotFoundException(id);
    }
    return zone;
  }

  /**
   * Validate that every id in `zoneIds` is an active zone at the branch.
   * @throws InvalidServiceZonesException listing the offending ids
   */
  async assertValidZones(
    tenantId: string,
    branchId: string,
    zoneIds: string[],
  ): Promise<void> {
    if (zoneIds.length === 0) return;
    const found = await this.prisma.serviceZone.findMany({
      where: { id: { in: zoneIds }, tenantId, branchId, deletedAt: null },
      select: { id: true },
    });
    const foundSet = new Set(found.map((z) => z.id));
    const invalid = zoneIds.filter((id) => !foundSet.has(id));
    if (invalid.length > 0) {
      throw new InvalidServiceZonesException(invalid);
    }
  }

  /**
   * Create a zone at the active branch.
   * @throws ServiceZoneNameConflictException on a duplicate active name
   */
  async create(
    tenantId: string,
    branchId: string,
    dto: CreateServiceZoneDto,
    actorId?: string,
  ): Promise<ServiceZone> {
    await this.assertNameFree(tenantId, branchId, dto.name);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.serviceZone.create({
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
   * Update a zone.
   * @throws ServiceZoneNotFoundException / ServiceZoneNameConflictException
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    dto: UpdateServiceZoneDto,
    actorId?: string,
  ): Promise<ServiceZone> {
    const existing = await this.findById(id, tenantId, branchId);
    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameFree(tenantId, branchId, dto.name, id);
    }
    const data: Prisma.ServiceZoneUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (actorId !== undefined) data.updatedBy = actorId;
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.serviceZone.update({ where: { id }, data }),
    );
  }

  /**
   * Soft-delete a zone.
   * @throws ServiceZoneNotFoundException if missing
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<ServiceZone> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.serviceZone.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    );
  }

  /** Reject a duplicate active zone name at the branch. */
  private async assertNameFree(
    tenantId: string,
    branchId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await this.prisma.serviceZone.findFirst({
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
      throw new ServiceZoneNameConflictException(name);
    }
  }
}
