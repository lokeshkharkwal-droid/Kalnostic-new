import { Injectable } from '@nestjs/common';
import { Area, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CityService } from './city.service';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import {
  AreaNotFoundException,
  LocationHierarchyMismatchException,
} from './exceptions/location.exceptions';

/** Filters for an area list query. */
interface AreaListFilters {
  search?: string;
  cityId?: string;
  stateId?: string;
  countryId?: string;
  isActive?: boolean;
}

/**
 * Area/locality management. Platform-level (no `tenantId`, no RLS). Bottom of the
 * hierarchy: an area belongs to one city and (denormalized) one state + country.
 * Before every write the parent city is validated and its `stateId`/`countryId`
 * are checked to match the supplied values, so the full chain stays consistent.
 */
@Injectable()
export class AreaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityService: CityService,
  ) {}

  /**
   * Create an area under an existing, active city. The denormalized
   * `stateId`/`countryId` must match the parent city's own ancestors.
   * @param dto validated area payload
   * @returns the created area
   * @throws CityNotFoundException if `cityId` is not an active city
   * @throws LocationHierarchyMismatchException if `stateId`/`countryId` ≠ city's
   */
  async create(dto: CreateAreaDto): Promise<Area> {
    await this.assertParents(dto.cityId, dto.stateId, dto.countryId);
    return this.prisma.area.create({
      data: {
        name: dto.name,
        locality: dto.locality,
        cityId: dto.cityId,
        stateId: dto.stateId,
        countryId: dto.countryId,
        isActive: dto.isActive ?? true,
      },
    });
  }

  /**
   * List active areas (offset pagination).
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (`name`/`locality`),
   *   cascading `cityId`/`stateId`/`countryId`, and `isActive` status
   */
  async findAll(
    page = 1,
    limit = 20,
    filters: AreaListFilters = {},
  ): Promise<PaginatedResult<Area>> {
    const where: Prisma.AreaWhereInput = { deletedAt: null };
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { locality: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filters.cityId) {
      where.cityId = filters.cityId;
    }
    if (filters.stateId) {
      where.stateId = filters.stateId;
    }
    if (filters.countryId) {
      where.countryId = filters.countryId;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    const data = await this.prisma.area.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
    });
    const total = await this.prisma.area.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active area.
   * @param id area id
   * @throws AreaNotFoundException if missing or soft-deleted
   */
  async findById(id: string): Promise<Area> {
    const area = await this.prisma.area.findFirst({
      where: { id, deletedAt: null },
    });
    if (!area) {
      throw new AreaNotFoundException(id);
    }
    return area;
  }

  /**
   * Update an area (name/locality/isActive). Parents are not re-parented.
   * @param id area id
   * @param dto partial update
   * @throws AreaNotFoundException if missing/soft-deleted
   */
  async update(id: string, dto: UpdateAreaDto): Promise<Area> {
    await this.findById(id);
    const data: Prisma.AreaUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.locality !== undefined) data.locality = dto.locality;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.area.update({ where: { id }, data });
  }

  /**
   * Soft-delete an area (sets `deletedAt`). An area is a leaf, so there is no
   * child check.
   * @param id area id
   * @throws AreaNotFoundException if missing/soft-deleted
   */
  async remove(id: string): Promise<Area> {
    await this.findById(id);
    return this.prisma.area.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Validate that the city exists and its state/country match the supplied ids.
   * @throws CityNotFoundException if the city is unknown/soft-deleted
   * @throws LocationHierarchyMismatchException if the ancestors differ
   */
  private async assertParents(
    cityId: string,
    stateId: string,
    countryId: string,
  ): Promise<void> {
    const city = await this.cityService.findById(cityId);
    if (city.stateId !== stateId || city.countryId !== countryId) {
      throw new LocationHierarchyMismatchException(
        "the area's state and country must match its city's state and country",
        {
          cityId,
          stateId,
          countryId,
          cityStateId: city.stateId,
          cityCountryId: city.countryId,
        },
      );
    }
  }
}
