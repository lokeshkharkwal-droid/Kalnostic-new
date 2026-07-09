import { Injectable } from '@nestjs/common';
import { Prisma, SupportInfo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateSupportInfoDto } from './dto/create-support-info.dto';
import { UpdateSupportInfoDto } from './dto/update-support-info.dto';
import { ListSupportInfoQueryDto } from './dto/list-support-info-query.dto';
import { SupportInfoListItem } from './entities/support-info.entity';
import {
  SupportInfoNotFoundException,
  SupportInfoTitleConflictException,
} from './exceptions/support-info.exceptions';

/** Columns returned by the listing endpoint (the required list contract). */
const LIST_SELECT = {
  id: true,
  metaType: true,
  code: true,
  title: true,
  updatedAt: true,
  tenantType: true,
  status: true,
} satisfies Prisma.SupportInfoSelect;

/**
 * Support-information management. Platform-level (CLAUDE.md §4.2 — no tenant, no
 * RLS): queries use the plain Prisma client directly. Every read filters
 * soft-deleted rows (`deletedAt: null`). Authored/edited by SiteAdmin; the
 * actor id is stored in `createdBy`/`updatedBy`.
 */
@Injectable()
export class SupportInfoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a support-information record.
   * @param actorId authoring SiteAdmin id (stored as createdBy/updatedBy)
   * @param dto validated payload
   * @returns the created record
   * @throws SupportInfoTitleConflictException if another active record already
   *   uses this title
   */
  async create(
    actorId: string,
    dto: CreateSupportInfoDto,
  ): Promise<SupportInfo> {
    await this.assertTitleAvailable(dto.title);
    return this.prisma.supportInfo.create({
      data: {
        metaType: dto.metaType,
        code: dto.code ?? null,
        title: dto.title,
        tenantType: dto.tenantType,
        status: dto.status ?? undefined,
        requestUrl: dto.requestUrl ?? null,
        helpContent: dto.helpContent,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  /**
   * List support-information records (offset pagination), projecting only the
   * listing columns.
   * @param query pagination + optional `search` (matched against `metaType` or
   *   `code`, case-insensitive) + `status` filter
   */
  async findAll(
    query: ListSupportInfoQueryDto,
  ): Promise<PaginatedResult<SupportInfoListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.SupportInfoWhereInput = { deletedAt: null };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { metaType: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.status = query.status;
    }
    const [data, total] = await Promise.all([
      this.prisma.supportInfo.findMany({
        where,
        select: LIST_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.supportInfo.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Fetch one active support-information record.
   * @param id record id
   * @throws SupportInfoNotFoundException if missing or soft-deleted
   */
  async findById(id: string): Promise<SupportInfo> {
    const record = await this.prisma.supportInfo.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) {
      throw new SupportInfoNotFoundException(id);
    }
    return record;
  }

  /**
   * Update a support-information record. A changed `title` is re-validated for
   * uniqueness among active rows.
   * @param id record id
   * @param actorId editing SiteAdmin id (stored as updatedBy)
   * @param dto partial update
   * @throws SupportInfoNotFoundException if missing or soft-deleted
   * @throws SupportInfoTitleConflictException if the new title collides
   */
  async update(
    id: string,
    actorId: string,
    dto: UpdateSupportInfoDto,
  ): Promise<SupportInfo> {
    const existing = await this.findById(id);
    if (dto.title !== undefined && dto.title !== existing.title) {
      await this.assertTitleAvailable(dto.title, id);
    }
    const data: Prisma.SupportInfoUpdateInput = { updatedBy: actorId };
    if (dto.metaType !== undefined) data.metaType = dto.metaType;
    if (dto.code !== undefined) data.code = dto.code ?? null;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.tenantType !== undefined) data.tenantType = dto.tenantType;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.requestUrl !== undefined) data.requestUrl = dto.requestUrl ?? null;
    if (dto.helpContent !== undefined) data.helpContent = dto.helpContent;
    return this.prisma.supportInfo.update({ where: { id }, data });
  }

  /**
   * Soft-delete a support-information record (sets `deletedAt`; the title becomes
   * reusable).
   * @param id record id
   * @throws SupportInfoNotFoundException if missing or already soft-deleted
   */
  async remove(id: string): Promise<SupportInfo> {
    await this.findById(id);
    return this.prisma.supportInfo.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Throw if an active record (other than `excludeId`) already uses `title`.
   * @param title candidate title
   * @param excludeId record to ignore (the one being updated)
   */
  private async assertTitleAvailable(
    title: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.supportInfo.findFirst({
      where: {
        title,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new SupportInfoTitleConflictException(title);
    }
  }
}
