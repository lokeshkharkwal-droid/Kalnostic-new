import { Injectable } from '@nestjs/common';
import { Country, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';
import {
  CountryNotFoundException,
  LocationHasChildrenException,
} from './exceptions/location.exceptions';

/** Filters for a country list query. */
interface CountryListFilters {
  search?: string;
  isActive?: boolean;
}

/**
 * Country management. Platform-level (no `tenantId`, no RLS) — this is global
 * geographic reference data owned by SiteAdmin and read by every tenant
 * (CLAUDE.md §4.2). Every query filters soft-deleted rows; deletes set
 * `deletedAt`. Top of the location hierarchy, so it validates no parent.
 */
@Injectable()
export class CountryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a country.
   * @param dto validated country payload
   * @returns the created country
   */
  async create(dto: CreateCountryDto): Promise<Country> {
    return this.prisma.country.create({
      data: {
        name: dto.name,
        code: dto.code,
        isActive: dto.isActive ?? true,
      },
    });
  }

  /**
   * List active countries (offset pagination).
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (`name`/`code`) and
   *   `isActive` status
   */
  async findAll(
    page = 1,
    limit = 20,
    filters: CountryListFilters = {},
  ): Promise<PaginatedResult<Country>> {
    const where: Prisma.CountryWhereInput = { deletedAt: null };
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    const data = await this.prisma.country.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
    });
    const total = await this.prisma.country.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active country. Also used by `StateService` to validate a state's
   * parent country before writing.
   * @param id country id
   * @throws CountryNotFoundException if missing or soft-deleted
   */
  async findById(id: string): Promise<Country> {
    const country = await this.prisma.country.findFirst({
      where: { id, deletedAt: null },
    });
    if (!country) {
      throw new CountryNotFoundException(id);
    }
    return country;
  }

  /**
   * Update a country (name/code/isActive). A country has no parent, so nothing
   * is re-parented here.
   * @param id country id
   * @param dto partial update
   * @throws CountryNotFoundException if missing/soft-deleted
   */
  async update(id: string, dto: UpdateCountryDto): Promise<Country> {
    await this.findById(id);
    const data: Prisma.CountryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.country.update({ where: { id }, data });
  }

  /**
   * Soft-delete a country (sets `deletedAt`). Blocked while the country still
   * has active states, to keep the hierarchy consistent.
   * @param id country id
   * @throws CountryNotFoundException if missing/soft-deleted
   * @throws LocationHasChildrenException if active states reference it
   */
  async remove(id: string): Promise<Country> {
    await this.findById(id);
    const childCount = await this.prisma.state.count({
      where: { countryId: id, deletedAt: null },
    });
    if (childCount > 0) {
      throw new LocationHasChildrenException('country', childCount);
    }
    return this.prisma.country.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
