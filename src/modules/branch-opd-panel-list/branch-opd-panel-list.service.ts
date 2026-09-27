import { Injectable } from '@nestjs/common';
import { BranchOpdPanel, BranchOpdPanelList, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeListPrice,
  resolveSourcePrice,
} from '../../common/utils/list-price.util';
import { CreateBranchOpdPanelListDto } from './dto/create-branch-opd-panel-list.dto';
import { CloneBranchOpdPanelListDto } from './dto/clone-branch-opd-panel-list.dto';
import { RenameBranchOpdPanelListDto } from './dto/rename-branch-opd-panel-list.dto';
import { BranchOpdPanelListOption } from './entities/branch-opd-panel-list.entity';
import {
  BranchOpdPanelListNameConflictException,
  BranchOpdPanelListNotFoundException,
  DefaultBranchOpdPanelListNotDeletableException,
} from './exceptions/branch-opd-panel-list.exceptions';

/** Fixed name of the auto-created default (Walk-in) list. */
export const DEFAULT_OPD_PANEL_LIST_NAME = 'Walk-in';

/** Row keys re-derived when cloning a BranchOpdPanel into another list. */
const CLONE_DROP_KEYS = ['id', 'createdAt', 'updatedAt', 'deletedAt'] as const;

/** A Prisma transaction client (from `withTenant`). */
type Tx = Prisma.TransactionClient;

/**
 * Branch **Opd Panel List** management — mirror of
 * `BranchOpdTestListService` for panels. A list owns full copies of its
 * `BranchOpdPanel` rows; each cloned panel's member composition
 * (`BranchOpdPanelTest`) is copied verbatim. The branch's single `isDefault`
 * list is "Walk-in". Tenant-scoped + branch-level (CLAUDE.md §4.7).
 */
@Injectable()
export class BranchOpdPanelListService {
  constructor(private readonly prisma: PrismaService) {}

  /** List all of the branch's Opd Panel Lists (default first, then by name). */
  async findAll(
    tenantId: string,
    branchId: string,
  ): Promise<BranchOpdPanelList[]> {
    return this.prisma.branchOpdPanelList.findMany({
      where: { tenantId, branchId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /** `{ id, name, isDefault }[]` options for the list selectors. */
  async findOptions(
    tenantId: string,
    branchId: string,
  ): Promise<BranchOpdPanelListOption[]> {
    return this.prisma.branchOpdPanelList.findMany({
      where: { tenantId, branchId, deletedAt: null },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Fetch one list scoped to tenant+branch.
   * @throws BranchOpdPanelListNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchOpdPanelList> {
    const row = await this.prisma.branchOpdPanelList.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!row) {
      throw new BranchOpdPanelListNotFoundException(id);
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
  ): Promise<BranchOpdPanelList> {
    const existing = await this.prisma.branchOpdPanelList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.branchOpdPanelList.create({
      data: {
        tenantId,
        branchId,
        name: DEFAULT_OPD_PANEL_LIST_NAME,
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
   * @throws BranchOpdPanelListNameConflictException if the name is taken
   */
  async create(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CreateBranchOpdPanelListDto,
  ): Promise<BranchOpdPanelList> {
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const defaultList = await this.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const sourceRows = await this.prisma.branchOpdPanel.findMany({
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
      const list = await tx.branchOpdPanelList.create({
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
   * @throws BranchOpdPanelListNotFoundException if the source list is missing
   * @throws BranchOpdPanelListNameConflictException if the new name is taken
   */
  async clone(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CloneBranchOpdPanelListDto,
  ): Promise<BranchOpdPanelList> {
    const source = await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const rows = await this.prisma.branchOpdPanel.findMany({
      where: { tenantId, branchId, listId: id, deletedAt: null },
    });
    return this.prisma.withTenant(tenantId, async (tx) => {
      const list = await tx.branchOpdPanelList.create({
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
   * @throws BranchOpdPanelListNotFoundException if missing
   * @throws BranchOpdPanelListNameConflictException if the new name is taken
   */
  async rename(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: RenameBranchOpdPanelListDto,
  ): Promise<BranchOpdPanelList> {
    await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name, id);
    return this.prisma.branchOpdPanelList.update({
      where: { id },
      data: { name: dto.name, updatedBy: actorId },
    });
  }

  /**
   * Soft-delete a list, its panel rows, and those panels' member tests. The default
   * Walk-in list cannot be deleted. One transaction.
   * @throws BranchOpdPanelListNotFoundException if missing
   * @throws DefaultBranchOpdPanelListNotDeletableException if it is the default
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchOpdPanelList> {
    const list = await this.findById(id, tenantId, branchId);
    if (list.isDefault) {
      throw new DefaultBranchOpdPanelListNotDeletableException();
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const now = new Date();
      const panels = await tx.branchOpdPanel.findMany({
        where: { tenantId, branchId, listId: id, deletedAt: null },
        select: { id: true },
      });
      const panelIds = panels.map((p) => p.id);
      if (panelIds.length) {
        await tx.branchOpdPanelTest.updateMany({
          where: {
            tenantId,
            branchLabPanelId: { in: panelIds },
            deletedAt: null,
          },
          data: { deletedAt: now },
        });
      }
      await tx.branchOpdPanel.updateMany({
        where: { tenantId, branchId, listId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.branchOpdPanelList.update({
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
    row: BranchOpdPanel,
    listId: string,
    listPrice: number,
    actorId: string | null,
    flags: { isDefault: boolean; isDuplicate: boolean },
  ): Promise<void> {
    const copy: Record<string, unknown> = { ...row };
    for (const key of CLONE_DROP_KEYS) {
      delete copy[key];
    }
    const created = await tx.branchOpdPanel.create({
      data: {
        ...copy,
        listId,
        listPrice,
        isDefault: flags.isDefault,
        isDuplicate: flags.isDuplicate,
        createdBy: actorId,
        updatedBy: actorId,
      } as Prisma.BranchOpdPanelUncheckedCreateInput,
    });
    const members = await tx.branchOpdPanelTest.findMany({
      where: {
        tenantId: row.tenantId,
        branchLabPanelId: row.id,
        deletedAt: null,
      },
    });
    for (const m of members) {
      await tx.branchOpdPanelTest.create({
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
    const clash = await this.prisma.branchOpdPanelList.findFirst({
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
      throw new BranchOpdPanelListNameConflictException(name);
    }
  }
}
