import { Injectable } from '@nestjs/common';
import { Prisma, State } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CountryService } from './country.service';
import { CreateStateDto } from './dto/create-state.dto';
import { UpdateStateDto } from './dto/update-state.dto';
import {
  LocationHasChildrenException,
  StateNotFoundException,
} from './exceptions/location.exceptions';

/** Filters for a state list query. */
interface StateListFilters {
  search?: string;
  countryId?: string;
  isActive?: boolean;
}

/**
 * State management. Platform-level (no `tenantId`, no RLS). A state belongs to
 * exactly one country; the parent is validated against the location master
 * before every write (invalid references are rejected). Injects `CountryService`
 * via the module (CLAUDE.md rule #3 — never import another service directly).
 */
@Injectable()
export class StateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countryService: CountryService,
  ) {}

  /**
   * Create a state under an existing, active country.
   * @param dto validated state payload
   * @returns the created state
   * @throws CountryNotFoundException if `countryId` is not an active country
   */
  async create(dto: CreateStateDto): Promise<State> {
    await this.countryService.findById(dto.countryId);
    return this.prisma.state.create({
      data: {
        name: dto.name,
        code: dto.code,
        countryId: dto.countryId,
        isActive: dto.isActive ?? true,
      },
    });
  }

  /**
   * List active states (offset pagination).
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (`name`/`code`), a
   *   cascading `countryId`, and `isActive` status
   */
  async findAll(
    page = 1,
    limit = 20,
    filters: StateListFilters = {},
  ): Promise<PaginatedResult<State>> {
    const where: Prisma.StateWhereInput = { deletedAt: null };
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filters.countryId) {
      where.countryId = filters.countryId;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    const data = await this.prisma.state.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
    });
    const total = await this.prisma.state.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active state. Also used by `CityService` to validate a city's
   * parent state before writing.
   * @param id state id
   * @throws StateNotFoundException if missing or soft-deleted
   */
  async findById(id: string): Promise<State> {
    const state = await this.prisma.state.findFirst({
      where: { id, deletedAt: null },
    });
    if (!state) {
      throw new StateNotFoundException(id);
    }
    return state;
  }

  /**
   * Update a state (name/code/isActive). The parent country is not re-parented.
   * @param id state id
   * @param dto partial update
   * @throws StateNotFoundException if missing/soft-deleted
   */
  async update(id: string, dto: UpdateStateDto): Promise<State> {
    await this.findById(id);
    const data: Prisma.StateUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.state.update({ where: { id }, data });
  }

  /**
   * Soft-delete a state (sets `deletedAt`). Blocked while it still has active
   * cities.
   * @param id state id
   * @throws StateNotFoundException if missing/soft-deleted
   * @throws LocationHasChildrenException if active cities reference it
   */
  async remove(id: string): Promise<State> {
    await this.findById(id);
    const childCount = await this.prisma.city.count({
      where: { stateId: id, deletedAt: null },
    });
    if (childCount > 0) {
      throw new LocationHasChildrenException('state', childCount);
    }
    return this.prisma.state.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
