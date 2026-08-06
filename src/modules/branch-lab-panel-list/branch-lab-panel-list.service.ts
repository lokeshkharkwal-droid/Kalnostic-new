import { Injectable } from '@nestjs/common';
import { BranchLabPanel, BranchLabPanelList, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeListPrice,
  resolveSourcePrice,
} from '../../common/utils/list-price.util';
import { CreateBranchLabPanelListDto } from './dto/create-branch-lab-panel-list.dto';
import { CloneBranchLabPanelListDto } from './dto/clone-branch-lab-panel-list.dto';
import { RenameBranchLabPanelListDto } from './dto/rename-branch-lab-panel-list.dto';
import { BranchLabPanelListOption } from './entities/branch-lab-panel-list.entity';
import {
  BranchLabPanelListNameConflictException,
  BranchLabPanelListNotFoundException,
  DefaultBranchLabPanelListNotDeletableException,
} from './exceptions/branch-lab-panel-list.exceptions';

/** Fixed name of the auto-created default (Walk-in) list. */
export const DEFAULT_LAB_PANEL_LIST_NAME = 'Walk-in';

/** Row keys re-derived when cloning a BranchLabPanel into another list. */
const CLONE_DROP_KEYS = ['id', 'createdAt', 'updatedAt', 'deletedAt'] as const;

/** A Prisma transaction client (from `withTenant`). */
type Tx = Prisma.TransactionClient;

/**
 * Branch **Lab Panel List** management — mirror of `BranchLabTestListService` for
 * panels. A list owns full copies of its `BranchLabPanel` rows (identity + all
 * price columns + a computed `listPrice`); each cloned panel's member composition
 * (`BranchLabPanelTest`) is copied verbatim so accession/reporting still resolve
 * (only the panel PRICE differs per list). The branch's single `isDefault` list is
 * "Walk-in". Tenant-scoped + branch-level (CLAUDE.md §4.7).
 */
@Injectable()
export class BranchLabPanelListService {
  constructor(private readonly prisma: PrismaService) {}

  /** List all of the branch's Lab Panel Lists (default first, then by name). */
  async findAll(
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabPanelList[]> {
    return this.prisma.branchLabPanelList.findMany({
      where: { tenantId, branchId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /** `{ id, name, isDefault }[]` options for the list selectors. */
  async findOptions(
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabPanelListOption[]> {
    return this.prisma.branchLabPanelList.findMany({
      where: { tenantId, branchId, deletedAt: null },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Fetch one list scoped to tenant+branch.
   * @throws BranchLabPanelListNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabPanelList> {
    const row = await this.prisma.branchLabPanelList.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!row) {
      throw new BranchLabPanelListNotFoundException(id);
    }
    return row;
  }

  /**
   * Resolve the branch's default (Walk-in) list, creating it if none exists.
   * Called by the branch-lab-panel import so the first import lands in Walk-in.
   */
  async getOrCreateDefaultList(
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchLabPanelList> {
    const existing = await this.prisma.branchLabPanelList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.branchLabPanelList.create({
      data: {
        tenantId,
        branchId,
        name: DEFAULT_LAB_PANEL_LIST_NAME,
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
   * default-variant panels (with member tests) and a `listPrice` computed from
   * `copyPriceFrom` + `priceType`. One transaction.
   * @throws BranchLabPanelListNameConflictException if the name is taken
   */
  async create(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CreateBranchLabPanelListDto,
  ): Promise<BranchLabPanelList> {
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const defaultList = await this.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const sourceRows = await this.prisma.branchLabPanel.findMany({
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
      const list = await tx.branchLabPanelList.create({
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
   * Deep-copy an existing list (and all its active panel rows + member tests,
   * preserving each row's `listPrice` and variant flags) into a new independent
   * list. One transaction.
   * @throws BranchLabPanelListNotFoundException if the source list is missing
   * @throws BranchLabPanelListNameConflictException if the new name is taken
   */
  async clone(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CloneBranchLabPanelListDto,
  ): Promise<BranchLabPanelList> {
    const source = await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const rows = await this.prisma.branchLabPanel.findMany({
      where: { tenantId, branchId, listId: id, deletedAt: null },
    });
    return this.prisma.withTenant(tenantId, async (tx) => {
      const list = await tx.branchLabPanelList.create({
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
   * @throws BranchLabPanelListNotFoundException if missing
   * @throws BranchLabPanelListNameConflictException if the new name is taken
   */
  async rename(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: RenameBranchLabPanelListDto,
  ): Promise<BranchLabPanelList> {
    await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name, id);
    return this.prisma.branchLabPanelList.update({
      where: { id },
      data: { name: dto.name, updatedBy: actorId },
    });
  }

  /**
   * Soft-delete a list, its panel rows, and those panels' member tests. The
   * default Walk-in list cannot be deleted. One transaction.
   * @throws BranchLabPanelListNotFoundException if missing
   * @throws DefaultBranchLabPanelListNotDeletableException if it is the default
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabPanelList> {
    const list = await this.findById(id, tenantId, branchId);
    if (list.isDefault) {
      throw new DefaultBranchLabPanelListNotDeletableException();
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const now = new Date();
      const panels = await tx.branchLabPanel.findMany({
        where: { tenantId, branchId, listId: id, deletedAt: null },
        select: { id: true },
      });
      const panelIds = panels.map((p) => p.id);
      if (panelIds.length) {
        await tx.branchLabPanelTest.updateMany({
          where: {
            tenantId,
            branchLabPanelId: { in: panelIds },
            deletedAt: null,
          },
          data: { deletedAt: now },
        });
      }
      await tx.branchLabPanel.updateMany({
        where: { tenantId, branchId, listId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.branchLabPanelList.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Create a copy of a source branch panel into `listId` with the given price and
   * variant flags, then copy its active member tests to the new panel (same
   * `branchLabTestId` — composition is shared across lists; only price differs).
   */
  private async clonePanelInto(
    tx: Tx,
    row: BranchLabPanel,
    listId: string,
    listPrice: number,
    actorId: string | null,
    flags: { isDefault: boolean; isDuplicate: boolean },
  ): Promise<void> {
    const copy: Record<string, unknown> = { ...row };
    for (const key of CLONE_DROP_KEYS) {
      delete copy[key];
    }
    const created = await tx.branchLabPanel.create({
      data: {
        ...copy,
        listId,
        listPrice,
        isDefault: flags.isDefault,
        isDuplicate: flags.isDuplicate,
        createdBy: actorId,
        updatedBy: actorId,
      } as Prisma.BranchLabPanelUncheckedCreateInput,
    });
    const members = await tx.branchLabPanelTest.findMany({
      where: {
        tenantId: row.tenantId,
        branchLabPanelId: row.id,
        deletedAt: null,
      },
    });
    for (const m of members) {
      await tx.branchLabPanelTest.create({
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
    const clash = await this.prisma.branchLabPanelList.findFirst({
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
      throw new BranchLabPanelListNameConflictException(name);
    }
  }
}
