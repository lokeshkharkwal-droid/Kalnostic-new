import { Injectable } from '@nestjs/common';
import { BranchOpdTest, BranchOpdTestList, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeListPrice,
  resolveSourcePrice,
} from '../../common/utils/list-price.util';
import { CreateBranchOpdTestListDto } from './dto/create-branch-opd-test-list.dto';
import { CloneBranchOpdTestListDto } from './dto/clone-branch-opd-test-list.dto';
import { RenameBranchOpdTestListDto } from './dto/rename-branch-opd-test-list.dto';
import { BranchOpdTestListOption } from './entities/branch-opd-test-list.entity';
import {
  BranchOpdTestListNameConflictException,
  BranchOpdTestListNotFoundException,
  DefaultBranchOpdTestListNotDeletableException,
} from './exceptions/branch-opd-test-list.exceptions';

/** Fixed name of the auto-created default (Walk-in) list. */
export const DEFAULT_OPD_TEST_LIST_NAME = 'Walk-in';

/** Row keys re-derived when cloning a BranchOpdTest into another list. */
const CLONE_DROP_KEYS = ['id', 'createdAt', 'updatedAt', 'deletedAt'] as const;

/**
 * Branch **Opd Test List** management. A list owns full copies of its
 * `BranchOpdTest` rows (identity + config + all price columns), plus a
 * computed `listPrice`. The branch's single `isDefault` list is "Walk-in",
 * auto-created on the first Master-Data import. Tenant-scoped + branch-level
 * (CLAUDE.md §4.7). Prisma-direct; multi-row writes run in `withTenant` transactions.
 */
@Injectable()
export class BranchOpdTestListService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all of the branch's Opd Test Lists (default first, then by name).
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   */
  async findAll(
    tenantId: string,
    branchId: string,
  ): Promise<BranchOpdTestList[]> {
    return this.prisma.branchOpdTestList.findMany({
      where: { tenantId, branchId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Lightweight `{ id, name, isDefault }[]` options for the list selectors.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   */
  async findOptions(
    tenantId: string,
    branchId: string,
  ): Promise<BranchOpdTestListOption[]> {
    const rows = await this.prisma.branchOpdTestList.findMany({
      where: { tenantId, branchId, deletedAt: null },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows;
  }

  /**
   * Fetch one list scoped to tenant+branch.
   * @throws BranchOpdTestListNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchOpdTestList> {
    const row = await this.prisma.branchOpdTestList.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!row) {
      throw new BranchOpdTestListNotFoundException(id);
    }
    return row;
  }

  /**
   * Resolve the branch's default (Walk-in) list, creating it if none exists.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created-by (or null)
   */
  async getOrCreateDefaultList(
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchOpdTestList> {
    const existing = await this.prisma.branchOpdTestList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.branchOpdTestList.create({
      data: {
        tenantId,
        branchId,
        name: DEFAULT_OPD_TEST_LIST_NAME,
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
   * default-variant tests with a `listPrice` computed from `copyPriceFrom` +
   * `priceType`. One transaction.
   * @throws BranchOpdTestListNameConflictException if the name is taken
   */
  async create(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CreateBranchOpdTestListDto,
  ): Promise<BranchOpdTestList> {
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const defaultList = await this.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const sourceRows = await this.prisma.branchOpdTest.findMany({
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
      const list = await tx.branchOpdTestList.create({
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
        await tx.branchOpdTest.create({
          data: this.cloneRowInto(row, list.id, listPrice, actorId, {
            isDefault: true,
            isDuplicate: false,
          }),
        });
      }
      return list;
    });
  }

  /**
   * Deep-copy an existing list (and all its active test rows, preserving each row's
   * `listPrice` and variant flags) into a new independent list. One transaction.
   * @throws BranchOpdTestListNotFoundException if the source list is missing
   * @throws BranchOpdTestListNameConflictException if the new name is taken
   */
  async clone(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CloneBranchOpdTestListDto,
  ): Promise<BranchOpdTestList> {
    const source = await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const rows = await this.prisma.branchOpdTest.findMany({
      where: { tenantId, branchId, listId: id, deletedAt: null },
    });
    return this.prisma.withTenant(tenantId, async (tx) => {
      const list = await tx.branchOpdTestList.create({
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
        await tx.branchOpdTest.create({
          data: this.cloneRowInto(row, list.id, row.listPrice, actorId, {
            isDefault: row.isDefault,
            isDuplicate: row.isDuplicate,
          }),
        });
      }
      return list;
    });
  }

  /**
   * Rename a list (name unique per branch among active lists).
   * @throws BranchOpdTestListNotFoundException if missing
   * @throws BranchOpdTestListNameConflictException if the new name is taken
   */
  async rename(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: RenameBranchOpdTestListDto,
  ): Promise<BranchOpdTestList> {
    await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name, id);
    return this.prisma.branchOpdTestList.update({
      where: { id },
      data: { name: dto.name, updatedBy: actorId },
    });
  }

  /**
   * Soft-delete a list and all of its test rows. The default Walk-in list cannot be
   * deleted. One transaction.
   * @throws BranchOpdTestListNotFoundException if missing
   * @throws DefaultBranchOpdTestListNotDeletableException if it is the default
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchOpdTestList> {
    const list = await this.findById(id, tenantId, branchId);
    if (list.isDefault) {
      throw new DefaultBranchOpdTestListNotDeletableException();
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const now = new Date();
      await tx.branchOpdTest.updateMany({
        where: { tenantId, branchId, listId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.branchOpdTestList.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Build the create payload for a BranchOpdTest cloned into another list.
   */
  private cloneRowInto(
    row: BranchOpdTest,
    listId: string,
    listPrice: number,
    actorId: string | null,
    flags: { isDefault: boolean; isDuplicate: boolean },
  ): Prisma.BranchOpdTestUncheckedCreateInput {
    const copy: Record<string, unknown> = { ...row };
    for (const key of CLONE_DROP_KEYS) {
      delete copy[key];
    }
    return {
      ...copy,
      listId,
      listPrice,
      isDefault: flags.isDefault,
      isDuplicate: flags.isDuplicate,
      createdBy: actorId,
      updatedBy: actorId,
    } as Prisma.BranchOpdTestUncheckedCreateInput;
  }

  /**
   * Throw if another active list in this branch already uses `name` (excludes
   * `excludeId` for renames).
   */
  private async assertNameAvailable(
    tenantId: string,
    branchId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.branchOpdTestList.findFirst({
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
      throw new BranchOpdTestListNameConflictException(name);
    }
  }
}
