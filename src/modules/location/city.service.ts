import { Injectable } from '@nestjs/common';
import { City, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CountryService } from './country.service';
import { StateService } from './state.service';
import { CreateCityDto } from './dto/create-city.dto';
import { UpdateCityDto } from './dto/update-city.dto';
import {
  CityNotFoundException,
  LocationHasChildrenException,
  LocationHierarchyMismatchException,
} from './exceptions/location.exceptions';

/** Filters for a city list query. */
interface CityListFilters {
  search?: string;
  stateId?: string;
  countryId?: string;
  isActive?: boolean;
}

/**
 * City management. Platform-level (no `tenantId`, no RLS). A city belongs to one
 * state and (denormalized) one country; before every write the parent state is
 * validated and its `countryId` is checked to match the supplied `countryId`, so
 * the Country → State → City chain can never become inconsistent.
 */
@Injectable()
export class CityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateService: StateService,
    private readonly countryService: CountryService,
  ) {}

  /**
   * Create a city under an existing, active state. The denormalized `countryId`
   * must match the parent state's country.
   * @param dto validated city payload
   * @returns the created city
   * @throws StateNotFoundException / CountryNotFoundException on unknown parents
   * @throws LocationHierarchyMismatchException if `countryId` ≠ state's country
   */
  async create(dto: CreateCityDto): Promise<City> {
    await this.assertParents(dto.stateId, dto.countryId);
    return this.prisma.city.create({
      data: {
        name: dto.name,
        pinCode: dto.pinCode,
        stateId: dto.stateId,
        countryId: dto.countryId,
        isActive: dto.isActive ?? true,
      },
    });
  }

  /**
   * List active cities (offset pagination).
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (`name`/`pinCode`),
   *   cascading `stateId`/`countryId`, and `isActive` status
   */
  async findAll(
    page = 1,
    limit = 20,
    filters: CityListFilters = {},
  ): Promise<PaginatedResult<City>> {
    const where: Prisma.CityWhereInput = { deletedAt: null };
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { pinCode: { contains: search, mode: 'insensitive' } },
      ];
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
    const data = await this.prisma.city.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
    });
    const total = await this.prisma.city.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active city. Also used by `AreaService` to validate an area's
   * parent city before writing.
   * @param id city id
   * @throws CityNotFoundException if missing or soft-deleted
   */
  async findById(id: string): Promise<City> {
    const city = await this.prisma.city.findFirst({
      where: { id, deletedAt: null },
    });
    if (!city) {
      throw new CityNotFoundException(id);
    }
    return city;
  }

  /**
   * Update a city (name/pinCode/isActive). Parents are not re-parented.
   * @param id city id
   * @param dto partial update
   * @throws CityNotFoundException if missing/soft-deleted
   */
  async update(id: string, dto: UpdateCityDto): Promise<City> {
    await this.findById(id);
    const data: Prisma.CityUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.pinCode !== undefined) data.pinCode = dto.pinCode;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.city.update({ where: { id }, data });
  }

  /**
   * Soft-delete a city (sets `deletedAt`). Blocked while it still has active
   * areas.
   * @param id city id
   * @throws CityNotFoundException if missing/soft-deleted
   * @throws LocationHasChildrenException if active areas reference it
   */
  async remove(id: string): Promise<City> {
    await this.findById(id);
    const childCount = await this.prisma.area.count({
      where: { cityId: id, deletedAt: null },
    });
    if (childCount > 0) {
      throw new LocationHasChildrenException('city', childCount);
    }
    return this.prisma.city.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Validate that the state exists and belongs to the supplied country.
   * @throws StateNotFoundException / CountryNotFoundException on unknown parents
   * @throws LocationHierarchyMismatchException if the state's country differs
   */
  private async assertParents(
    stateId: string,
    countryId: string,
  ): Promise<void> {
    await this.countryService.findById(countryId);
    const state = await this.stateService.findById(stateId);
    if (state.countryId !== countryId) {
      throw new LocationHierarchyMismatchException(
        "the city's country must match its state's country",
        { stateId, countryId, stateCountryId: state.countryId },
      );
    }
  }
}
