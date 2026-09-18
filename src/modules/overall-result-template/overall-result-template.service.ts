import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateOverallResultTemplateDto } from './dto/create-overall-result-template.dto';
import { UpdateOverallResultTemplateDto } from './dto/update-overall-result-template.dto';
import { ListOverallResultTemplateDto } from './dto/list-overall-result-template.dto';
import { ListOverallResultGroupNamesDto } from './dto/list-overall-result-group-names.dto';
import { OverallResultTemplateEntity } from './entities/overall-result-template.entity';
import {
  OverallResultTemplateNameConflictException,
  OverallResultTemplateNotFoundException,
} from './exceptions/overall-result-template.exceptions';

/**
 * Overall Result template management (Business Admin › Business Settings ›
 * Overall Results). Tenant-scoped, tenant-level (CLAUDE.md §4.6): every query
 * carries `tenantId` (defence in depth on top of RLS, §4.3) and filters
 * soft-deleted rows. `groupName` is free text and not validated against any
 * catalogue — it is matched by string equality wherever a future phase
 * associates a template with a lab test's result-parameter group.
 */
@Injectable()
export class OverallResultTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an Overall Result template.
   * @param tenantId owning tenant (from JWT)
   * @param dto validated payload (no `tenantId` — set from context)
   * @param actorId person id of the creator (optional audit trail)
   * @returns the created template
   * @throws OverallResultTemplateNameConflictException if the name is already
   *   used by another active template in this tenant
   */
  async create(
    tenantId: string,
    dto: CreateOverallResultTemplateDto,
    actorId?: string,
  ): Promise<OverallResultTemplateEntity> {
    const data: Prisma.OverallResultTemplateUncheckedCreateInput = {
      ...dto,
      tenantId,
      createdBy: actorId ?? null,
      updatedBy: actorId ?? null,
    };
    try {
      return await this.prisma.overallResultTemplate.create({ data });
    } catch (e) {
      this.rethrowConflict(e, dto.name);
      throw e;
    }
  }

  /**
   * Fetch one active template scoped to its tenant.
   * @param id template id
   * @param tenantId tenant scope
   * @throws OverallResultTemplateNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<OverallResultTemplateEntity> {
    const template = await this.prisma.overallResultTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!template) {
      throw new OverallResultTemplateNotFoundException(id);
    }
    return template;
  }

  /**
   * List active templates for a tenant (offset pagination). Optional
   * case-insensitive `search` on `name`, exact `groupName`, and `status`
   * filters. Always scoped by tenant.
   * @param tenantId tenant scope
   * @param query pagination + optional filters
   */
  async findAll(
    tenantId: string,
    query: ListOverallResultTemplateDto,
  ): Promise<PaginatedResult<OverallResultTemplateEntity>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.OverallResultTemplateWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;
    // groupName (single, exact) and groupNames (plural, IN) are additive, not
    // both-required — combine them as OR rather than letting the second
    // assignment silently overwrite the first (Prisma ANDs top-level keys, so
    // two separate `where.groupName = ...` lines would only keep the last one).
    if (query.groupName && query.groupNames?.length) {
      where.OR = [
        { groupName: { equals: query.groupName, mode: 'insensitive' } },
        { groupName: { in: query.groupNames, mode: 'insensitive' } },
      ];
    } else if (query.groupName) {
      where.groupName = { equals: query.groupName, mode: 'insensitive' };
    } else if (query.groupNames?.length) {
      where.groupName = { in: query.groupNames, mode: 'insensitive' };
    }
    if (query.search) {
      const search = query.search.trim();
      if (search) {
        where.name = { contains: search, mode: 'insensitive' };
      }
    }
    const [data, total] = await Promise.all([
      this.prisma.overallResultTemplate.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.overallResultTemplate.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * List the distinct, active `groupName` values in a tenant (alphabetical,
   * offset-paginated, optional case-insensitive `search`). Used to populate
   * the "Overall Result" group picker on a lab test result parameter
   * (`LabTestResultParam.overallResultGroups`) — a parameter links to a group
   * name, not a specific template row.
   * @param tenantId tenant scope
   * @param query pagination + optional search
   */
  async findDistinctGroupNames(
    tenantId: string,
    query: ListOverallResultGroupNamesDto,
  ): Promise<PaginatedResult<string>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.OverallResultTemplateWhereInput = {
      tenantId,
      deletedAt: null,
      status: 'ACTIVE',
    };
    if (query.search) {
      const search = query.search.trim();
      if (search) {
        where.groupName = { contains: search, mode: 'insensitive' };
      }
    }
    const [grouped, totalGrouped] = await Promise.all([
      this.prisma.overallResultTemplate.groupBy({
        by: ['groupName'],
        where,
        orderBy: { groupName: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.overallResultTemplate.groupBy({
        by: ['groupName'],
        where,
      }),
    ]);
    return {
      data: grouped.map((g) => g.groupName),
      total: totalGrouped.length,
      page,
      limit,
    };
  }

  /**
   * Update an Overall Result template.
   * @param id template id
   * @param tenantId tenant scope
   * @param dto partial update
   * @param actorId person id of the editor (optional audit trail)
   * @throws OverallResultTemplateNotFoundException / …NameConflictException
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateOverallResultTemplateDto,
    actorId?: string,
  ): Promise<OverallResultTemplateEntity> {
    const existing = await this.findById(id, tenantId);

    const data: Prisma.OverallResultTemplateUpdateInput = { ...dto };
    if (actorId !== undefined) {
      data.updatedBy = actorId;
    }

    try {
      await this.prisma.overallResultTemplate.update({ where: { id }, data });
    } catch (e) {
      this.rethrowConflict(e, dto.name ?? existing.name);
      throw e;
    }
    return this.findById(id, tenantId);
  }

  /**
   * Soft-delete an Overall Result template (sets `deletedAt`; row is
   * preserved).
   * @param id template id
   * @param tenantId tenant scope
   * @throws OverallResultTemplateNotFoundException if missing/soft-deleted
   */
  async remove(
    id: string,
    tenantId: string,
  ): Promise<OverallResultTemplateEntity> {
    await this.findById(id, tenantId);
    return this.prisma.overallResultTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Map a caught error to a 409 name conflict when it is a unique-constraint
   * violation (P2002) on the `(tenantId, name)` active-rows index. Returns
   * silently for any other error so the caller can rethrow it unchanged.
   * @param e the caught error
   * @param name the template name (for the conflict message)
   */
  private rethrowConflict(e: unknown, name: string): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new OverallResultTemplateNameConflictException(name);
    }
  }
}
