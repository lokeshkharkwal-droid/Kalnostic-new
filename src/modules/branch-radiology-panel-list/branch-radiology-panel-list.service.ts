import { Injectable } from '@nestjs/common';
import {
  BranchRadiologyPanel,
  BranchRadiologyPanelList,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeListPrice,
  resolveSourcePrice,
} from '../../common/utils/list-price.util';
import { CreateBranchRadiologyPanelListDto } from './dto/create-branch-radiology-panel-list.dto';
import { CloneBranchRadiologyPanelListDto } from './dto/clone-branch-radiology-panel-list.dto';
import { RenameBranchRadiologyPanelListDto } from './dto/rename-branch-radiology-panel-list.dto';
import { BranchRadiologyPanelListOption } from './entities/branch-radiology-panel-list.entity';
import {
  BranchRadiologyPanelListNameConflictException,
  BranchRadiologyPanelListNotFoundException,
  DefaultBranchRadiologyPanelListNotDeletableException,
} from './exceptions/branch-radiology-panel-list.exceptions';

/** Fixed name of the auto-created default (Walk-in) list. */
export const DEFAULT_RADIOLOGY_PANEL_LIST_NAME = 'Walk-in';

/** Row keys re-derived when cloning a BranchRadiologyPanel into another list. */
const CLONE_DROP_KEYS = ['id', 'createdAt', 'updatedAt', 'deletedAt'] as const;

/** A Prisma transaction client (from `withTenant`). */
type Tx = Prisma.TransactionClient;

/**
 * Branch **Radiology Panel List** management — mirror of
 * `BranchRadiologyTestListService` for panels. A list owns full copies of its
 * `BranchRadiologyPanel` rows; each cloned panel's member composition
 * (`BranchRadiologyPanelTest`) is copied verbatim. The branch's single `isDefault`
 * list is "Walk-in". Tenant-scoped + branch-level (CLAUDE.md §4.7).
 */
@Injectable()
export class BranchRadiologyPanelListService {
  constructor(private readonly prisma: PrismaService) {}

  /** List all of the branch's Radiology Panel Lists (default first, then by name). */
  async findAll(
    tenantId: string,
    branchId: string,
  ): Promise<BranchRadiologyPanelList[]> {
    return this.prisma.branchRadiologyPanelList.findMany({
      where: { tenantId, branchId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /** `{ id, name, isDefault }[]` options for the list selectors. */
  async findOptions(
    tenantId: string,
    branchId: string,
  ): Promise<BranchRadiologyPanelListOption[]> {
    return this.prisma.branchRadiologyPanelList.findMany({
      where: { tenantId, branchId, deletedAt: null },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Fetch one list scoped to tenant+branch.
   * @throws BranchRadiologyPanelListNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchRadiologyPanelList> {
    const row = await this.prisma.branchRadiologyPanelList.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!row) {
      throw new BranchRadiologyPanelListNotFoundException(id);
    }
    return row;
  }

  /**
   * Resolve the branch's default (Walk-in) list, creating it if none exists.
   */
  async getOrCreateDefaultList(
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchRadiologyPanelList> {
    const existing = await this.prisma.branchRadiologyPanelList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.branchRadiologyPanelList.create({
      data: {
        tenantId,
        branchId,
        name: DEFAULT_RADIOLOGY_PANEL_LIST_NAME,
        isDefault: true,
        priceType: 'CUSTOMIZED',
        copyPriceFrom: 'MSRP',
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  /**
   * Create a new (non-default) list, seeded by cloning the default list's active
   * default-variant panels (with member tests). One transaction.
   * @throws BranchRadiologyPanelListNameConflictException if the name is taken
   */
  async create(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CreateBranchRadiologyPanelListDto,
  ): Promise<BranchRadiologyPanelList> {
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const defaultList = await this.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const sourceRows = await this.prisma.branchRadiologyPanel.findMany({
      where: {
        tenantId,
        branchId,
        listId: defaultList.id,
        isDefault: true,
        deletedAt: null,
      },
    });
    const percentage =
      dto.priceType === 'PERCENTAGE' ? (dto.copyPercentage ?? 0) : null;

    return this.prisma.withTenant(tenantId, async (tx) => {
      const list = await tx.branchRadiologyPanelList.create({
        data: {
          tenantId,
          branchId,
          name: dto.name,
          isDefault: false,
          priceType: dto.priceType,
          copyPriceFrom: dto.copyPriceFrom,
          copyPercentage: percentage,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      for (const row of sourceRows) {
        const base = resolveSourcePrice(row, dto.copyPriceFrom);
        const listPrice = computeListPrice(base, dto.priceType, percentage);
        await this.clonePanelInto(tx, row, list.id, listPrice, actorId, {
          isDefault: true,
          isDuplicate: false,
        });
      }
      return list;
    });
  }

  /**
   * Deep-copy an existing list (and all its active panel rows + member tests) into a
   * new independent list. One transaction.
   * @throws BranchRadiologyPanelListNotFoundException if the source list is missing
   * @throws BranchRadiologyPanelListNameConflictException if the new name is taken
   */
  async clone(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CloneBranchRadiologyPanelListDto,
  ): Promise<BranchRadiologyPanelList> {
    const source = await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const rows = await this.prisma.branchRadiologyPanel.findMany({
      where: { tenantId, branchId, listId: id, deletedAt: null },
    });
    return this.prisma.withTenant(tenantId, async (tx) => {
      const list = await tx.branchRadiologyPanelList.create({
        data: {
          tenantId,
          branchId,
          name: dto.name,
          isDefault: false,
          priceType: source.priceType,
          copyPriceFrom: source.copyPriceFrom,
          copyPercentage: source.copyPercentage,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      for (const row of rows) {
        await this.clonePanelInto(tx, row, list.id, row.listPrice, actorId, {
          isDefault: row.isDefault,
          isDuplicate: row.isDuplicate,
        });
      }
      return list;
    });
  }

  /**
   * Rename a list (name unique per branch among active lists).
   * @throws BranchRadiologyPanelListNotFoundException if missing
   * @throws BranchRadiologyPanelListNameConflictException if the new name is taken
   */
  async rename(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: RenameBranchRadiologyPanelListDto,
  ): Promise<BranchRadiologyPanelList> {
    await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name, id);
    return this.prisma.branchRadiologyPanelList.update({
      where: { id },
      data: { name: dto.name, updatedBy: actorId },
    });
  }

  /**
   * Soft-delete a list, its panel rows, and those panels' member tests. The default
   * Walk-in list cannot be deleted. One transaction.
   * @throws BranchRadiologyPanelListNotFoundException if missing
   * @throws DefaultBranchRadiologyPanelListNotDeletableException if it is the default
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchRadiologyPanelList> {
    const list = await this.findById(id, tenantId, branchId);
    if (list.isDefault) {
      throw new DefaultBranchRadiologyPanelListNotDeletableException();
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const now = new Date();
      const panels = await tx.branchRadiologyPanel.findMany({
        where: { tenantId, branchId, listId: id, deletedAt: null },
        select: { id: true },
      });
      const panelIds = panels.map((p) => p.id);
      if (panelIds.length) {
        await tx.branchRadiologyPanelTest.updateMany({
          where: {
            tenantId,
            branchLabPanelId: { in: panelIds },
            deletedAt: null,
          },
          data: { deletedAt: now },
        });
      }
      await tx.branchRadiologyPanel.updateMany({
        where: { tenantId, branchId, listId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.branchRadiologyPanelList.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Create a copy of a source branch panel into `listId`, then copy its active
   * member tests to the new panel (same `branchLabTestId` — composition is shared).
   */
  private async clonePanelInto(
    tx: Tx,
    row: BranchRadiologyPanel,
    listId: string,
    listPrice: number,
    actorId: string | null,
    flags: { isDefault: boolean; isDuplicate: boolean },
  ): Promise<void> {
    const copy: Record<string, unknown> = { ...row };
    for (const key of CLONE_DROP_KEYS) {
      delete copy[key];
    }
    const created = await tx.branchRadiologyPanel.create({
      data: {
        ...copy,
        listId,
        listPrice,
        isDefault: flags.isDefault,
        isDuplicate: flags.isDuplicate,
        createdBy: actorId,
        updatedBy: actorId,
      } as Prisma.BranchRadiologyPanelUncheckedCreateInput,
    });
    const members = await tx.branchRadiologyPanelTest.findMany({
      where: {
        tenantId: row.tenantId,
        branchLabPanelId: row.id,
        deletedAt: null,
      },
    });
    for (const m of members) {
      await tx.branchRadiologyPanelTest.create({
        data: {
          tenantId: m.tenantId,
          branchId: m.branchId,
          branchLabPanelId: created.id,
          branchLabTestId: m.branchLabTestId,
          sortOrder: m.sortOrder,
          isRemovable: m.isRemovable,
        },
      });
    }
  }

  /**
   * Throw if another active list in this branch already uses `name`
   * (excludes `excludeId` for renames).
   */
  private async assertNameAvailable(
    tenantId: string,
    branchId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.branchRadiologyPanelList.findFirst({
      where: {
        tenantId,
        branchId,
        name,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new BranchRadiologyPanelListNameConflictException(name);
    }
  }
}
