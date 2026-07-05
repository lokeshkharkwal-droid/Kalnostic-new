import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import {
  LabImageSetting,
  LabPdfSetting,
  LabGroupLayoutSetting,
  LabIconSetting,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateImageSettingDto } from './dto/create-image-setting.dto';
import { UpdateImageSettingDto } from './dto/update-image-setting.dto';
import { CreatePdfSettingDto } from './dto/create-pdf-setting.dto';
import { UpdatePdfSettingDto } from './dto/update-pdf-setting.dto';
import { CreateGroupLayoutSettingDto } from './dto/create-group-layout-setting.dto';
import { UpdateGroupLayoutSettingDto } from './dto/update-group-layout-setting.dto';
import { CreateIconSettingDto } from './dto/create-icon-setting.dto';
import { UpdateIconSettingDto } from './dto/update-icon-setting.dto';
import {
  LabImageSettingNotFoundException,
  LabPdfSettingNotFoundException,
  LabGroupLayoutSettingNotFoundException,
  LabIconSettingNotFoundException,
  IconFileMismatchException,
} from './exceptions/lab-test-settings.exceptions';

/** One stored icon: uploaded file URL + its display configuration. */
export interface IconEntry {
  iconUrl: string;
  position: string;
  alignment: string;
  size: string;
  visibility: string;
}

/**
 * Lab Test Settings service. Tenant-scoped: every query carries `tenantId`
 * (defence in depth on top of RLS — CLAUDE.md §4.3) and filters soft-deleted rows.
 */
@Injectable()
export class LabTestSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * List active image settings for a tenant (offset pagination), newest first.
   * Optional `filters.search` narrows the result set server-side with a
   * case-insensitive match against the setting `name`.
   * @param tenantId owning tenant
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param branchId when set (Branch Admin), narrows to that branch's rows;
   *   when omitted/null (Business Admin), returns tenant-wide across all branches
   * @param filters optional search filter
   */
  async findAll(
    tenantId: string,
    page = 1,
    limit = 20,
    branchId?: string | null,
    filters: { search?: string } = {},
  ): Promise<PaginatedResult<LabImageSetting>> {
    const where: Prisma.LabImageSettingWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (branchId) where.branchId = branchId;
    if (filters.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }
    const data = await this.prisma.labImageSetting.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.labImageSetting.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active image setting scoped to its tenant (and branch, for a
   * Branch Admin — see class-level branch-scoping note).
   * @param id image setting id
   * @param tenantId owning tenant
   * @param branchId when set (Branch Admin), the row must belong to this
   *   branch — a tenant-wide (branchId: null) or another branch's row is
   *   treated as not found; omitted/null (Business Admin) does not restrict
   * @throws LabImageSettingNotFoundException if missing, soft-deleted, or
   *   (for a Branch Admin) not owned by their branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ): Promise<LabImageSetting> {
    const record = await this.prisma.labImageSetting.findFirst({
      where: { id, tenantId, deletedAt: null, ...(branchId && { branchId }) },
    });
    if (!record) throw new LabImageSettingNotFoundException(id);
    return record;
  }

  /**
   * Create an image setting within a tenant.
   * @param tenantId owning tenant
   * @param dto validated image setting payload
   * @param branchId active branch (Branch Admin) to stamp on the row, or
   *   null/omitted for a tenant-wide setting (Business Admin)
   * @returns the created image setting
   */
  async create(
    tenantId: string,
    dto: CreateImageSettingDto,
    branchId?: string | null,
  ): Promise<LabImageSetting> {
    return this.prisma.labImageSetting.create({
      data: {
        tenantId,
        branchId: branchId ?? null,
        name: dto.name,
        displayPosition: dto.displayPosition,
        layout: dto.layout,
        alignment: dto.alignment,
        imageSize: dto.imageSize,
        aspectRatio1: dto.aspectRatio1 ?? null,
        aspectRatio2: dto.aspectRatio2 ?? null,
        aspectRatio3: dto.aspectRatio3 ?? null,
        aspectRatio4: dto.aspectRatio4 ?? null,
        pageBreakControl: dto.pageBreakControl,
        headerRetention: dto.headerRetention,
        replacementMode: dto.replacementMode,
        status: dto.status ?? 'Active',
      },
    });
  }

  /**
   * Update an existing image setting. Only supplied fields are changed.
   * @param id image setting id
   * @param tenantId owning tenant
   * @param dto partial update payload
   * @param branchId when set (Branch Admin), restricts the update to a row
   *   owned by this branch; a tenant-wide row is not editable by a Branch Admin
   * @throws LabImageSettingNotFoundException if missing, soft-deleted, or not
   *   owned by the caller's branch
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateImageSettingDto,
    branchId?: string | null,
  ): Promise<LabImageSetting> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.labImageSetting.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.displayPosition !== undefined && {
          displayPosition: dto.displayPosition,
        }),
        ...(dto.layout !== undefined && { layout: dto.layout }),
        ...(dto.alignment !== undefined && { alignment: dto.alignment }),
        ...(dto.imageSize !== undefined && { imageSize: dto.imageSize }),
        ...(dto.aspectRatio1 !== undefined && {
          aspectRatio1: dto.aspectRatio1,
        }),
        ...(dto.aspectRatio2 !== undefined && {
          aspectRatio2: dto.aspectRatio2,
        }),
        ...(dto.aspectRatio3 !== undefined && {
          aspectRatio3: dto.aspectRatio3,
        }),
        ...(dto.aspectRatio4 !== undefined && {
          aspectRatio4: dto.aspectRatio4,
        }),
        ...(dto.pageBreakControl !== undefined && {
          pageBreakControl: dto.pageBreakControl,
        }),
        ...(dto.headerRetention !== undefined && {
          headerRetention: dto.headerRetention,
        }),
        ...(dto.replacementMode !== undefined && {
          replacementMode: dto.replacementMode,
        }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  /**
   * Soft-delete an image setting (sets deletedAt; row is preserved).
   * @param id image setting id
   * @param tenantId owning tenant
   * @param branchId when set (Branch Admin), restricts the delete to a row
   *   owned by this branch; a tenant-wide row is not deletable by a Branch Admin
   * @throws LabImageSettingNotFoundException if missing, already soft-deleted,
   *   or not owned by the caller's branch
   */
  async remove(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ): Promise<LabImageSetting> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.labImageSetting.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── PDF Settings ─────────────────────────────────────────────────────────

  /**
   * List active PDF settings for a tenant (offset pagination), newest first.
   * @param tenantId owning tenant
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param branchId when set (Branch Admin), narrows to that branch's rows;
   *   when omitted/null (Business Admin), returns tenant-wide across all branches
   */
  async findAllPdfSettings(
    tenantId: string,
    page = 1,
    limit = 20,
    branchId?: string | null,
    filters: { search?: string } = {},
  ): Promise<PaginatedResult<LabPdfSetting>> {
    const where: Prisma.LabPdfSettingWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (branchId) where.branchId = branchId;
    if (filters.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }
    const data = await this.prisma.labPdfSetting.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.labPdfSetting.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active PDF setting scoped to its tenant (and branch, for a
   * Branch Admin — see class-level branch-scoping note).
   * @param id PDF setting id
   * @param tenantId owning tenant
   * @param branchId when set (Branch Admin), the row must belong to this
   *   branch — a tenant-wide (branchId: null) or another branch's row is
   *   treated as not found; omitted/null (Business Admin) does not restrict
   * @throws LabPdfSettingNotFoundException if missing, soft-deleted, or (for
   *   a Branch Admin) not owned by their branch
   */
  async findPdfSettingById(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ): Promise<LabPdfSetting> {
    const record = await this.prisma.labPdfSetting.findFirst({
      where: { id, tenantId, deletedAt: null, ...(branchId && { branchId }) },
    });
    if (!record) throw new LabPdfSettingNotFoundException(id);
    return record;
  }

  /**
   * Create a PDF setting within a tenant.
   * @param tenantId owning tenant
   * @param dto validated PDF setting payload
   * @param branchId active branch (Branch Admin) to stamp on the row, or
   *   null/omitted for a tenant-wide setting (Business Admin)
   * @returns the created PDF setting
   */
  async createPdfSetting(
    tenantId: string,
    dto: CreatePdfSettingDto,
    branchId?: string | null,
  ): Promise<LabPdfSetting> {
    return this.prisma.labPdfSetting.create({
      data: {
        tenantId,
        branchId: branchId ?? null,
        name: dto.name,
        pdfMode: dto.pdfMode,
        placement: dto.placement,
        scaleMode: dto.scaleMode,
        customScalePct: dto.customScalePct ?? null,
        pageBreakControl: dto.pageBreakControl,
        status: dto.status ?? 'Active',
      },
    });
  }

  /**
   * Update an existing PDF setting. Only supplied fields are changed.
   * @param id PDF setting id
   * @param tenantId owning tenant
   * @param dto partial update payload
   * @param branchId when set (Branch Admin), restricts the update to a row
   *   owned by this branch; a tenant-wide row is not editable by a Branch Admin
   * @throws LabPdfSettingNotFoundException if missing, soft-deleted, or not
   *   owned by the caller's branch
   */
  async updatePdfSetting(
    id: string,
    tenantId: string,
    dto: UpdatePdfSettingDto,
    branchId?: string | null,
  ): Promise<LabPdfSetting> {
    await this.findPdfSettingById(id, tenantId, branchId);
    return this.prisma.labPdfSetting.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.pdfMode !== undefined && { pdfMode: dto.pdfMode }),
        ...(dto.placement !== undefined && { placement: dto.placement }),
        ...(dto.scaleMode !== undefined && { scaleMode: dto.scaleMode }),
        ...(dto.customScalePct !== undefined && {
          customScalePct: dto.customScalePct,
        }),
        ...(dto.pageBreakControl !== undefined && {
          pageBreakControl: dto.pageBreakControl,
        }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  /**
   * Soft-delete a PDF setting (sets deletedAt; row is preserved).
   * @param id PDF setting id
   * @param tenantId owning tenant
   * @param branchId when set (Branch Admin), restricts the delete to a row
   *   owned by this branch; a tenant-wide row is not deletable by a Branch Admin
   * @throws LabPdfSettingNotFoundException if missing, already soft-deleted,
   *   or not owned by the caller's branch
   */
  async removePdfSetting(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ): Promise<LabPdfSetting> {
    await this.findPdfSettingById(id, tenantId, branchId);
    return this.prisma.labPdfSetting.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Group Layout Settings ───────────────────────────────────────────────

  /**
   * List active group layout settings for a tenant (offset pagination),
   * newest first.
   * @param tenantId owning tenant
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param branchId when set (Branch Admin), narrows to that branch's rows;
   *   when omitted/null (Business Admin), returns tenant-wide across all branches
   */
  async findAllGroupLayoutSettings(
    tenantId: string,
    page = 1,
    limit = 20,
    branchId?: string | null,
    filters: { search?: string } = {},
  ): Promise<PaginatedResult<LabGroupLayoutSetting>> {
    const where: Prisma.LabGroupLayoutSettingWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (branchId) where.branchId = branchId;
    if (filters.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }
    const data = await this.prisma.labGroupLayoutSetting.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.labGroupLayoutSetting.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active group layout setting scoped to its tenant (and branch,
   * for a Branch Admin — see class-level branch-scoping note).
   * @param id group layout setting id
   * @param tenantId owning tenant
   * @param branchId when set (Branch Admin), the row must belong to this
   *   branch — a tenant-wide (branchId: null) or another branch's row is
   *   treated as not found; omitted/null (Business Admin) does not restrict
   * @throws LabGroupLayoutSettingNotFoundException if missing, soft-deleted,
   *   or (for a Branch Admin) not owned by their branch
   */
  async findGroupLayoutSettingById(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ): Promise<LabGroupLayoutSetting> {
    const record = await this.prisma.labGroupLayoutSetting.findFirst({
      where: { id, tenantId, deletedAt: null, ...(branchId && { branchId }) },
    });
    if (!record) throw new LabGroupLayoutSettingNotFoundException(id);
    return record;
  }

  /**
   * Create a group layout setting within a tenant.
   * @param tenantId owning tenant
   * @param dto validated group layout setting payload
   * @param branchId active branch (Branch Admin) to stamp on the row, or
   *   null/omitted for a tenant-wide setting (Business Admin)
   * @returns the created group layout setting
   */
  async createGroupLayoutSetting(
    tenantId: string,
    dto: CreateGroupLayoutSettingDto,
    branchId?: string | null,
  ): Promise<LabGroupLayoutSetting> {
    return this.prisma.labGroupLayoutSetting.create({
      data: {
        tenantId,
        branchId: branchId ?? null,
        name: dto.name,
        nameAlignment: dto.nameAlignment,
        columnLayout: dto.columnLayout,
        resultAlignment: dto.resultAlignment,
        displayStyle: dto.displayStyle,
        status: dto.status ?? 'Active',
      },
    });
  }

  /**
   * Update an existing group layout setting. Only supplied fields are changed.
   * @param id group layout setting id
   * @param tenantId owning tenant
   * @param dto partial update payload
   * @param branchId when set (Branch Admin), restricts the update to a row
   *   owned by this branch; a tenant-wide row is not editable by a Branch Admin
   * @throws LabGroupLayoutSettingNotFoundException if missing, soft-deleted,
   *   or not owned by the caller's branch
   */
  async updateGroupLayoutSetting(
    id: string,
    tenantId: string,
    dto: UpdateGroupLayoutSettingDto,
    branchId?: string | null,
  ): Promise<LabGroupLayoutSetting> {
    await this.findGroupLayoutSettingById(id, tenantId, branchId);
    return this.prisma.labGroupLayoutSetting.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameAlignment !== undefined && {
          nameAlignment: dto.nameAlignment,
        }),
        ...(dto.columnLayout !== undefined && {
          columnLayout: dto.columnLayout,
        }),
        ...(dto.resultAlignment !== undefined && {
          resultAlignment: dto.resultAlignment,
        }),
        ...(dto.displayStyle !== undefined && {
          displayStyle: dto.displayStyle,
        }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  /**
   * Soft-delete a group layout setting (sets deletedAt; row is preserved).
   * @param id group layout setting id
   * @param tenantId owning tenant
   * @param branchId when set (Branch Admin), restricts the delete to a row
   *   owned by this branch; a tenant-wide row is not deletable by a Branch Admin
   * @throws LabGroupLayoutSettingNotFoundException if missing, already
   *   soft-deleted, or not owned by the caller's branch
   */
  async removeGroupLayoutSetting(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ): Promise<LabGroupLayoutSetting> {
    await this.findGroupLayoutSettingById(id, tenantId, branchId);
    return this.prisma.labGroupLayoutSetting.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Icon Settings ────────────────────────────────────────────────────────

  /**
   * List active icon settings for a tenant (offset pagination), newest first.
   * @param tenantId owning tenant
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param branchId when set (Branch Admin), narrows to that branch's rows;
   *   when omitted/null (Business Admin), returns tenant-wide across all branches
   */
  async findAllIconSettings(
    tenantId: string,
    page = 1,
    limit = 20,
    branchId?: string | null,
    filters: { search?: string } = {},
  ): Promise<PaginatedResult<LabIconSetting>> {
    const where: Prisma.LabIconSettingWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (branchId) where.branchId = branchId;
    if (filters.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }
    const data = await this.prisma.labIconSetting.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.labIconSetting.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active icon setting scoped to its tenant (and branch, for a
   * Branch Admin — see class-level branch-scoping note).
   * @param id icon setting id
   * @param tenantId owning tenant
   * @param branchId when set (Branch Admin), the row must belong to this
   *   branch — a tenant-wide (branchId: null) or another branch's row is
   *   treated as not found; omitted/null (Business Admin) does not restrict
   * @throws LabIconSettingNotFoundException if missing, soft-deleted, or (for
   *   a Branch Admin) not owned by their branch
   */
  async findIconSettingById(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ): Promise<LabIconSetting> {
    const record = await this.prisma.labIconSetting.findFirst({
      where: { id, tenantId, deletedAt: null, ...(branchId && { branchId }) },
    });
    if (!record) throw new LabIconSettingNotFoundException(id);
    return record;
  }

  /**
   * Create an icon setting within a tenant. `dto.icons` (1 or 2 entries)
   * must have exactly one uploaded file per entry, matched by array index:
   * `files[0]` → `dto.icons[0]`, `files[1]` → `dto.icons[1]`.
   * @param tenantId owning tenant
   * @param dto validated icon setting payload (metadata only, no file data)
   * @param files uploaded icon image files, in the same order as `dto.icons`
   * @param branchId active branch (Branch Admin) to stamp on the row, or
   *   null/omitted for a tenant-wide setting (Business Admin)
   * @returns the created icon setting
   * @throws IconFileMismatchException if the file count doesn't match `dto.icons.length`
   */
  async createIconSetting(
    tenantId: string,
    dto: CreateIconSettingDto,
    files: Express.Multer.File[],
    branchId?: string | null,
  ): Promise<LabIconSetting> {
    if (files.length !== dto.icons.length) {
      throw new IconFileMismatchException(
        `Expected ${dto.icons.length} icon file(s), received ${files.length}`,
        { expected: dto.icons.length, received: files.length },
      );
    }
    const icons = await this.storeIconFiles(dto.icons, files);
    return this.prisma.labIconSetting.create({
      data: {
        tenantId,
        branchId: branchId ?? null,
        name: dto.name,
        iconCount: icons.length,
        icons: icons as unknown as Prisma.InputJsonValue,
        status: dto.status ?? 'Active',
      },
    });
  }

  /**
   * Update an existing icon setting. Only supplied fields are changed. When
   * `dto.icons` is supplied, a replacement file for a given slot is optional —
   * omitting `files[i]` (undefined) keeps that slot's existing `iconUrl`.
   * @param id icon setting id
   * @param tenantId owning tenant
   * @param dto partial update payload
   * @param files replacement icon files, sparse-aligned to `dto.icons` (or
   *   `undefined` if `dto.icons` was not supplied)
   * @param branchId when set (Branch Admin), restricts the update to a row
   *   owned by this branch; a tenant-wide row is not editable by a Branch Admin
   * @throws LabIconSettingNotFoundException if missing, soft-deleted, or not
   *   owned by the caller's branch
   * @throws IconFileMismatchException if `dto.icons` is supplied and its
   *   length doesn't match `files.length`
   */
  async updateIconSetting(
    id: string,
    tenantId: string,
    dto: UpdateIconSettingDto,
    files: Array<Express.Multer.File | undefined>,
    branchId?: string | null,
  ): Promise<LabIconSetting> {
    const existing = await this.findIconSettingById(id, tenantId, branchId);
    const data: Prisma.LabIconSettingUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.icons !== undefined) {
      if (files.length !== dto.icons.length) {
        throw new IconFileMismatchException(
          `Expected ${dto.icons.length} icon slot(s), received ${files.length}`,
          { expected: dto.icons.length, received: files.length },
        );
      }
      const existingIcons = existing.icons as unknown as IconEntry[];
      const icons = await this.storeIconFiles(dto.icons, files, existingIcons);
      data.iconCount = icons.length;
      data.icons = icons as unknown as Prisma.InputJsonValue;
    }
    return this.prisma.labIconSetting.update({ where: { id }, data });
  }

  /**
   * Soft-delete an icon setting (sets deletedAt; row is preserved).
   * @param id icon setting id
   * @param tenantId owning tenant
   * @param branchId when set (Branch Admin), restricts the delete to a row
   *   owned by this branch; a tenant-wide row is not deletable by a Branch Admin
   * @throws LabIconSettingNotFoundException if missing, already soft-deleted,
   *   or not owned by the caller's branch
   */
  async removeIconSetting(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ): Promise<LabIconSetting> {
    await this.findIconSettingById(id, tenantId, branchId);
    return this.prisma.labIconSetting.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Write each uploaded icon file to disk and pair it with its config to
   * build the stored `icons` JSON array. When `files[i]` is `undefined` (an
   * update that didn't replace that slot), falls back to `previous[i]`'s
   * `iconUrl` — `previous` must be supplied in that case.
   * @param configs per-icon display configuration (position/alignment/size/visibility)
   * @param files uploaded files, index-aligned to `configs` (an entry may be
   *   `undefined` on update when that slot's icon isn't being replaced)
   * @param previous the setting's current icons, for carrying forward an
   *   unreplaced slot's `iconUrl` on update
   */
  private async storeIconFiles(
    configs: CreateIconSettingDto['icons'],
    files: Array<Express.Multer.File | undefined>,
    previous?: IconEntry[],
  ): Promise<IconEntry[]> {
    const dir = this.config.get<string>('UPLOAD_DIR', './uploads');
    await mkdir(dir, { recursive: true });

    const icons: IconEntry[] = [];
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      if (!config) {
        throw new IconFileMismatchException(
          `Icon slot ${i + 1} is missing its configuration`,
          { slot: i + 1 },
        );
      }
      const file = files[i];
      const previousEntry = previous?.[i];
      let iconUrl: string;
      if (file) {
        const ext = extname(file.originalname) || '.png';
        const fileName = `icon-${randomBytes(6).toString('hex')}${ext}`;
        await writeFile(join(dir, fileName), file.buffer);
        iconUrl = `${dir.replace(/\\/g, '/')}/${fileName}`.replace(
          /^\.\//,
          '/',
        );
      } else if (previousEntry) {
        iconUrl = previousEntry.iconUrl;
      } else {
        throw new IconFileMismatchException(
          `Icon slot ${i + 1} has no uploaded file and no existing icon to keep`,
          { slot: i + 1 },
        );
      }
      icons.push({ iconUrl, ...config });
    }
    return icons;
  }
}
