import { Injectable } from '@nestjs/common';
import { BranchLabTest, BranchLabTestList, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeListPrice,
  resolveSourcePrice,
} from '../../common/utils/list-price.util';
import { CreateBranchLabTestListDto } from './dto/create-branch-lab-test-list.dto';
import { CloneBranchLabTestListDto } from './dto/clone-branch-lab-test-list.dto';
import { RenameBranchLabTestListDto } from './dto/rename-branch-lab-test-list.dto';
import { BranchLabTestListOption } from './entities/branch-lab-test-list.entity';
import {
  BranchLabTestListNameConflictException,
  BranchLabTestListNotFoundException,
  DefaultBranchLabTestListNotDeletableException,
} from './exceptions/branch-lab-test-list.exceptions';

/** Fixed name of the auto-created default (Walk-in) list. */
export const DEFAULT_LAB_TEST_LIST_NAME = 'Walk-in';

/** Row keys re-derived when cloning a BranchLabTest into another list. */
const CLONE_DROP_KEYS = ['id', 'createdAt', 'updatedAt', 'deletedAt'] as const;

/**
 * Branch **Lab Test List** management. A list owns full copies of its
 * `BranchLabTest` rows (identity + config + all price columns), plus a computed
 * `listPrice`. The branch's single `isDefault` list is "Walk-in", auto-created on
 * the first Master-Data import (see `getOrCreateDefaultList`, called by
 * `BranchLabTestService`). Tenant-scoped + branch-level (CLAUDE.md §4.7): tenant
 * and branch come from the JWT, never the body. Prisma-direct; multi-row writes
 * run in `withTenant` transactions.
 */
@Injectable()
export class BranchLabTestListService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all of the branch's Lab Test Lists (default first, then by name).
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   */
  async findAll(
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabTestList[]> {
    return this.prisma.branchLabTestList.findMany({
      where: { tenantId, branchId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Lightweight `{ id, name, isDefault }[]` options for the referral/registration
   * list selectors — never individual tests.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   */
  async findOptions(
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabTestListOption[]> {
    const rows = await this.prisma.branchLabTestList.findMany({
      where: { tenantId, branchId, deletedAt: null },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows;
  }

  /**
   * Fetch one list scoped to tenant+branch.
   * @throws BranchLabTestListNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabTestList> {
    const row = await this.prisma.branchLabTestList.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!row) {
      throw new BranchLabTestListNotFoundException(id);
    }
    return row;
  }

  /**
   * Resolve the branch's default (Walk-in) list, creating it if none exists.
   * Called by the branch-lab-test import so the first import lands in Walk-in.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created-by (or null)
   */
  async getOrCreateDefaultList(
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchLabTestList> {
    const existing = await this.prisma.branchLabTestList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.branchLabTestList.create({
      data: {
        tenantId,
        branchId,
        name: DEFAULT_LAB_TEST_LIST_NAME,
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
   * `priceType` (percentage or copy-as-is). Editing the new list never affects the
   * default. One transaction so the list + its rows commit atomically.
   * @throws BranchLabTestListNameConflictException if the name is taken
   */
  async create(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CreateBranchLabTestListDto,
  ): Promise<BranchLabTestList> {
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const defaultList = await this.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const sourceRows = await this.prisma.branchLabTest.findMany({
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
      const list = await tx.branchLabTestList.create({
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
        await tx.branchLabTest.create({
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
   * Deep-copy an existing list (and all its active test rows, preserving each
   * row's `listPrice` and variant flags) into a new independent list. The clone is
   * never a default. One transaction.
   * @throws BranchLabTestListNotFoundException if the source list is missing
   * @throws BranchLabTestListNameConflictException if the new name is taken
   */
  async clone(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CloneBranchLabTestListDto,
  ): Promise<BranchLabTestList> {
    const source = await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name);
    const rows = await this.prisma.branchLabTest.findMany({
      where: { tenantId, branchId, listId: id, deletedAt: null },
    });
    return this.prisma.withTenant(tenantId, async (tx) => {
      const list = await tx.branchLabTestList.create({
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
        await tx.branchLabTest.create({
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
   * @throws BranchLabTestListNotFoundException if missing
   * @throws BranchLabTestListNameConflictException if the new name is taken
   */
  async rename(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: RenameBranchLabTestListDto,
  ): Promise<BranchLabTestList> {
    await this.findById(id, tenantId, branchId);
    await this.assertNameAvailable(tenantId, branchId, dto.name, id);
    return this.prisma.branchLabTestList.update({
      where: { id },
      data: { name: dto.name, updatedBy: actorId },
    });
  }

  /**
   * Soft-delete a list and all of its test rows. The default Walk-in list cannot
   * be deleted. One transaction.
   * @throws BranchLabTestListNotFoundException if missing
   * @throws DefaultBranchLabTestListNotDeletableException if it is the default
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabTestList> {
    const list = await this.findById(id, tenantId, branchId);
    if (list.isDefault) {
      throw new DefaultBranchLabTestListNotDeletableException();
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const now = new Date();
      await tx.branchLabTest.updateMany({
        where: { tenantId, branchId, listId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.branchLabTestList.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Build the create payload for a BranchLabTest cloned into another list: copy
   * all scalars except re-derived ones, retarget `listId`, set `listPrice` and
   * variant flags, and stamp the actor.
   */
  private cloneRowInto(
    row: BranchLabTest,
    listId: string,
    listPrice: number,
    actorId: string | null,
    flags: { isDefault: boolean; isDuplicate: boolean },
  ): Prisma.BranchLabTestUncheckedCreateInput {
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
    } as Prisma.BranchLabTestUncheckedCreateInput;
  }

  /**
   * Throw if another active list in this branch already uses `name` (case-sensitive
   * match on the DB unique index; excludes `excludeId` for renames).
   */
  private async assertNameAvailable(
    tenantId: string,
    branchId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.branchLabTestList.findFirst({
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
      throw new BranchLabTestListNameConflictException(name);
    }
  }
}
