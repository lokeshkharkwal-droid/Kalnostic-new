import { Injectable } from '@nestjs/common';
import {
  BranchRadiologyTest,
  BranchRadiologyTestList,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeListPrice,
  resolveSourcePrice,
} from '../../common/utils/list-price.util';
import { CreateBranchRadiologyTestListDto } from './dto/create-branch-radiology-test-list.dto';
import { CloneBranchRadiologyTestListDto } from './dto/clone-branch-radiology-test-list.dto';
import { RenameBranchRadiologyTestListDto } from './dto/rename-branch-radiology-test-list.dto';
import { BranchRadiologyTestListOption } from './entities/branch-radiology-test-list.entity';
import {
  BranchRadiologyTestListNameConflictException,
  BranchRadiologyTestListNotFoundException,
  DefaultBranchRadiologyTestListNotDeletableException,
} from './exceptions/branch-radiology-test-list.exceptions';

/** Fixed name of the auto-created default (Walk-in) list. */
export const DEFAULT_RADIOLOGY_TEST_LIST_NAME = 'Walk-in';

/** Row keys re-derived when cloning a BranchRadiologyTest into another list. */
const CLONE_DROP_KEYS = ['id', 'createdAt', 'updatedAt', 'deletedAt'] as const;

/**
 * Branch **Radiology Test List** management. A list owns full copies of its
 * `BranchRadiologyTest` rows (identity + config + all price columns), plus a
 * computed `listPrice`. The branch's single `isDefault` list is "Walk-in",
 * auto-created on the first Master-Data import. Tenant-scoped + branch-level
 * (CLAUDE.md §4.7). Prisma-direct; multi-row writes run in `withTenant` transactions.
 */
@Injectable()
export class BranchRadiologyTestListService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all of the branch's Radiology Test Lists (default first, then by name).
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   */
  async findAll(
    tenantId: string,
    branchId: string,
  ): Promise<BranchRadiologyTestList[]> {
    return this.prisma.branchRadiologyTestList.findMany({
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
  ): Promise<BranchRadiologyTestListOption[]> {
    const rows = await this.prisma.branchRadiologyTestList.findMany({
      where: { tenantId, branchId, deletedAt: null },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows;
  }

  /**
   * Fetch one list scoped to tenant+branch.
   * @throws BranchRadiologyTestListNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchRadiologyTestList> {
    const row = await this.prisma.branchRadiologyTestList.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!row) {
      throw new BranchRadiologyTestListNotFoundException(id);
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
  ): Promise<BranchRadiologyTestList> {
    const existing = await this.prisma.branchRadiologyTestList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.branchRadiologyTestList.create({
      data: {
        tenantId,
        branchId,
        name: DEFAULT_RADIOLOGY_TEST_LIST_NAME,
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
   * @throws BranchRadiologyTestListNameConflictException if the name is taken
   */
  async create(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CreateBranchRadiologyTestListDto,
  ): Promise<BranchRadiologyTestList> {
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const defaultList = await this.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const sourceRows = await this.prisma.branchRadiologyTest.findMany({
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
      const list = await tx.branchRadiologyTestList.create({
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
        await tx.branchRadiologyTest.create({
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
   * @throws BranchRadiologyTestListNotFoundException if the source list is missing
   * @throws BranchRadiologyTestListNameConflictException if the new name is taken
   */
  async clone(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CloneBranchRadiologyTestListDto,
  ): Promise<BranchRadiologyTestList> {
    const source = await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const rows = await this.prisma.branchRadiologyTest.findMany({
      where: { tenantId, branchId, listId: id, deletedAt: null },
    });
    return this.prisma.withTenant(tenantId, async (tx) => {
      const list = await tx.branchRadiologyTestList.create({
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
        await tx.branchRadiologyTest.create({
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
   * @throws BranchRadiologyTestListNotFoundException if missing
   * @throws BranchRadiologyTestListNameConflictException if the new name is taken
   */
  async rename(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: RenameBranchRadiologyTestListDto,
  ): Promise<BranchRadiologyTestList> {
    await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name, id);
    return this.prisma.branchRadiologyTestList.update({
      where: { id },
      data: { name: dto.name, updatedBy: actorId },
    });
  }

  /**
   * Soft-delete a list and all of its test rows. The default Walk-in list cannot be
   * deleted. One transaction.
   * @throws BranchRadiologyTestListNotFoundException if missing
   * @throws DefaultBranchRadiologyTestListNotDeletableException if it is the default
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchRadiologyTestList> {
    const list = await this.findById(id, tenantId, branchId);
    if (list.isDefault) {
      throw new DefaultBranchRadiologyTestListNotDeletableException();
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const now = new Date();
      await tx.branchRadiologyTest.updateMany({
        where: { tenantId, branchId, listId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.branchRadiologyTestList.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Build the create payload for a BranchRadiologyTest cloned into another list.
   */
  private cloneRowInto(
    row: BranchRadiologyTest,
    listId: string,
    listPrice: number,
    actorId: string | null,
    flags: { isDefault: boolean; isDuplicate: boolean },
  ): Prisma.BranchRadiologyTestUncheckedCreateInput {
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
    } as Prisma.BranchRadiologyTestUncheckedCreateInput;
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
    const clash = await this.prisma.branchRadiologyTestList.findFirst({
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
      throw new BranchRadiologyTestListNameConflictException(name);
    }
  }
}
