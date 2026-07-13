import { Injectable } from '@nestjs/common';
import { BranchLabTest, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from '../lab-test/lab-test.service';
import { LabTestWithChildren } from '../lab-test/entities/lab-test.entity';
import { LabTestNotFoundException } from '../lab-test/exceptions/lab-test.exceptions';
import { ImportBranchLabTestsDto } from './dto/import-branch-lab-tests.dto';
import { SyncBranchLabTestsDto } from './dto/sync-branch-lab-tests.dto';
import { ListBranchLabTestsQueryDto } from './dto/list-branch-lab-tests-query.dto';
import { UpdateBranchLabTestDto } from './dto/update-branch-lab-test.dto';
import {
  BranchLabTestDefaultConflictException,
  BranchLabTestNotFoundException,
} from './exceptions/branch-lab-test.exceptions';
import {
  BranchLabTestImportResult,
  BranchLabTestSyncResult,
} from './entities/branch-lab-test.entity';

/** The scope/actor a source Master Data test is materialized into. */
interface ImportTarget {
  tenantId: string;
  branchId: string;
  sourceMasterDataId: string;
  actorId: string | null;
}

/**
 * Source keys that are re-derived (never copied) or folded into `configSnapshot`
 * when materializing a branch lab test from a composed Master Data test.
 */
const BRANCH_TEST_DROP_KEYS = [
  'id',
  'tenantId',
  'branchId',
  'masterDataId',
  'source',
  'versionHistory',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'samples',
  'resultParams',
];

/**
 * A branch's operational **Lab Test List** — materialized, independent snapshots
 * copied from the branch's Master Data lab tests. Tenant-scoped + branch-level;
 * tenant/branch come from the JWT (never the body). Import copies selected Master
 * Data tests (deep clinical config folded into `configSnapshot`); sync overwrites
 * copies from their source; edits here never propagate back to Master Data.
 * Prisma-direct; multi-row writes run in `withTenant` transactions. Source rows
 * are always composed BEFORE opening a `withTenant` tx (nested service reads need
 * the per-op RLS GUC, which a `withTenant` connection does not expose to them).
 */
@Injectable()
export class BranchLabTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: MasterDataService,
    private readonly labTestService: LabTestService,
  ) {}

  /**
   * Persist-import the selected Master Data lab tests into the active branch's
   * Lab Test List. Each source (of the branch's 1:1 master data) is deep-copied
   * as the group's imported original (`isDefault=true`, `isDuplicate=false`) with
   * a fresh id and its clinical children snapshotted into `configSnapshot`.
   * Idempotent: a source whose variant group already has an active row (matched
   * by `sourceLabTestId`) is skipped, as is any id not found in the branch's
   * master data. Copies run in one transaction.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the source lab-test ids to import
   * @returns counts of copied vs skipped tests
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   */
  async importFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: ImportBranchLabTestsDto,
  ): Promise<BranchLabTestImportResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    const validSources = await this.prisma.labTest.findMany({
      where: {
        id: { in: dto.labTestIds },
        masterDataId: masterData.id,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    const validIds = validSources.map((s) => s.id);
    // A source is already imported if its variant group (sourceLabTestId) has any
    // active row — regardless of duplicates/renames.
    const existing = await this.prisma.branchLabTest.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        sourceLabTestId: { in: validIds },
      },
      select: { sourceLabTestId: true },
    });
    const importedSources = new Set(existing.map((t) => t.sourceLabTestId));

    const toCreate: Prisma.BranchLabTestUncheckedCreateInput[] = [];
    let skipped = dto.labTestIds.length - validIds.length;
    for (const id of validIds) {
      if (importedSources.has(id)) {
        skipped += 1;
        continue;
      }
      importedSources.add(id);
      const source = await this.labTestService.findById(
        masterData.id,
        id,
        tenantId,
      );
      toCreate.push(
        this.buildImportData(source, {
          tenantId,
          branchId,
          sourceMasterDataId: masterData.id,
          actorId,
        }),
      );
    }

    if (toCreate.length) {
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          for (const data of toCreate) {
            await tx.branchLabTest.create({ data });
          }
        });
      } catch (e) {
        this.rethrowConflict(e);
        throw e;
      }
    }
    return { copied: toCreate.length, skipped };
  }

  /**
   * Re-snapshot branch lab tests from their source Master Data tests. Reloads
   * each copy's source (via `sourceLabTestId`) and OVERWRITES the copy's parent
   * fields and clinical snapshot with the current Master Data values — any
   * branch-level edits are discarded (agreed overwrite contract). Copies whose
   * source is missing/soft-deleted are left untouched and counted as skipped.
   * Updates run in one transaction.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto optional subset of branch-lab-test ids to sync (omit = all)
   * @returns counts of synced vs skipped copies
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   */
  async syncFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: SyncBranchLabTestsDto,
  ): Promise<BranchLabTestSyncResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    const where: Prisma.BranchLabTestWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
      // Only imported originals are re-snapshotted; user duplicates keep their
      // independent edits (agreed sync contract).
      isDuplicate: false,
      sourceLabTestId: { not: null },
    };
    if (dto.branchLabTestIds?.length) {
      where.id = { in: dto.branchLabTestIds };
    }
    const copies = await this.prisma.branchLabTest.findMany({
      where,
      select: { id: true, sourceLabTestId: true },
    });

    const updates: {
      id: string;
      data: Prisma.BranchLabTestUncheckedUpdateInput;
    }[] = [];
    let skipped = 0;
    for (const copy of copies) {
      if (!copy.sourceLabTestId) {
        skipped += 1;
        continue;
      }
      try {
        const source = await this.labTestService.findById(
          masterData.id,
          copy.sourceLabTestId,
          tenantId,
        );
        updates.push({
          id: copy.id,
          data: this.buildSyncData(source, actorId),
        });
      } catch (e) {
        if (e instanceof LabTestNotFoundException) {
          skipped += 1;
          continue;
        }
        throw e;
      }
    }

    if (updates.length) {
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          for (const u of updates) {
            await tx.branchLabTest.update({
              where: { id: u.id },
              data: u.data,
            });
          }
        });
      } catch (e) {
        this.rethrowConflict(e);
        throw e;
      }
    }
    return { synced: updates.length, skipped };
  }

  /**
   * List the branch's Lab Test List (paginated). Supports a case-insensitive
   * `search` on testName/testCode and an active `status` filter.
   * @param tenantId tenant scope
   * @param branchId active branch
   * @param query pagination + filters
   */
  async findAll(
    tenantId: string,
    branchId: string,
    query: ListBranchLabTestsQueryDto,
  ): Promise<PaginatedResult<BranchLabTest>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.BranchLabTestWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
    const term = query.search?.trim();
    if (term) {
      where.OR = [
        { testName: { contains: term, mode: 'insensitive' } },
        { testCode: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.isActive = query.status === 'ACTIVE';
    }
    const [data, total] = await Promise.all([
      this.prisma.branchLabTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { testName: 'asc' },
      }),
      this.prisma.branchLabTest.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Lightweight `{ id, name }` options for the Create-Order lab-test selector.
   * Returns the branch's **active default-variant** rows only (one orderable row
   * per variant group), so a selected id is directly usable as an order item's
   * `branchLabTestId`. Supports a case-insensitive `search` on testName.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param filters optional search + offset pagination
   * @returns full `{ id, name }[]` when `page` is omitted, else a paginated envelope
   */
  async findOptions(
    tenantId: string,
    branchId: string,
    filters: { search?: string; page?: number; limit?: number } = {},
  ): Promise<
    | Array<{ id: string; name: string }>
    | PaginatedResult<{ id: string; name: string }>
  > {
    const where: Prisma.BranchLabTestWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
      isActive: true,
      isDefault: true,
    };
    const term = filters.search?.trim();
    if (term) {
      where.testName = { contains: term, mode: 'insensitive' };
    }

    const select = { id: true, testName: true } as const;
    const orderBy = { testName: 'asc' } as const;
    const toOption = (r: { id: string; testName: string }) => ({
      id: r.id,
      name: r.testName,
    });

    if (filters.page === undefined) {
      const rows = await this.prisma.branchLabTest.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map(toOption);
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.branchLabTest.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.branchLabTest.count({ where }),
    ]);
    return { data: rows.map(toOption), total, page, limit };
  }

  /**
   * Fetch one branch lab test (with its `configSnapshot`) scoped to tenant+branch.
   * @throws BranchLabTestNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabTest> {
    const row = await this.prisma.branchLabTest.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!row) {
      throw new BranchLabTestNotFoundException(id);
    }
    return row;
  }

  /**
   * Edit a branch lab test's branch-tunable fields (pricing, flags, TAT, notes,
   * display, active). Identity/classification/clinical snapshot are not editable
   * here (managed via re-import/sync). Validates price ordering before writing.
   * @throws BranchLabTestNotFoundException if missing
   * @throws ValidationException if the merged prices violate min ≤ max ≤ msrp
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: UpdateBranchLabTestDto,
  ): Promise<BranchLabTest> {
    const current = await this.findById(id, tenantId, branchId);
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? current.priceMsrp,
      priceMaximum: dto.priceMaximum ?? current.priceMaximum,
      priceMinimum: dto.priceMinimum ?? current.priceMinimum,
    });
    return this.prisma.branchLabTest.update({
      where: { id },
      data: { ...dto, updatedBy: actorId },
    });
  }

  /**
   * Enable/disable a branch lab test in the branch's Lab Test List.
   * @throws BranchLabTestNotFoundException if missing
   */
  async setActive(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    isActive: boolean,
  ): Promise<BranchLabTest> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.branchLabTest.update({
      where: { id },
      data: { isActive, updatedBy: actorId },
    });
  }

  /**
   * Duplicate a branch lab test into an independent, editable variant in the same
   * group (same `sourceLabTestId`). The copy starts as a non-default duplicate
   * (`isDuplicate=true`, `isDefault=false`) so it is untouched by sync; its
   * display name is suffixed " (Copy)". All scalar fields + `configSnapshot` are
   * copied. Single write → per-op RLS.
   * @throws BranchLabTestNotFoundException if the source row is missing
   */
  async duplicate(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchLabTest> {
    const row = await this.findById(id, tenantId, branchId);
    return this.prisma.branchLabTest.create({
      data: this.buildDuplicateData(row, actorId),
    });
  }

  /**
   * Mark a branch lab test as the default of its variant group (used for order
   * creation). Clears `isDefault` on the group's other active rows first, then
   * sets this one — one transaction so the one-default-per-group index holds.
   * @throws BranchLabTestNotFoundException if missing
   */
  async setDefault(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchLabTest> {
    const row = await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (row.sourceLabTestId) {
        await tx.branchLabTest.updateMany({
          where: {
            tenantId,
            branchId,
            sourceLabTestId: row.sourceLabTestId,
            deletedAt: null,
            isDefault: true,
            id: { not: id },
          },
          data: { isDefault: false },
        });
      }
      return tx.branchLabTest.update({
        where: { id },
        data: { isDefault: true, updatedBy: actorId },
      });
    });
  }

  /**
   * Soft-delete a branch lab test (removes it from the branch's Lab Test List). If
   * it was the group's default and active siblings remain, one is promoted to
   * default so the group keeps an orderable row.
   * @throws BranchLabTestNotFoundException if missing
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabTest> {
    const row = await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await tx.branchLabTest.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      if (row.isDefault && row.sourceLabTestId) {
        const sibling = await tx.branchLabTest.findFirst({
          where: {
            tenantId,
            branchId,
            sourceLabTestId: row.sourceLabTestId,
            deletedAt: null,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (sibling) {
          await tx.branchLabTest.update({
            where: { id: sibling.id },
            data: { isDefault: true },
          });
        }
      }
      return deleted;
    });
  }

  /**
   * Build the create payload for a branch lab test from a composed Master Data
   * test. Copies all parent scalars, folds the children into `configSnapshot`,
   * and stamps the branch scope + provenance. Public so the branch-lab-panel
   * import can materialize member-test copies with identical semantics.
   * @param source the composed source lab test (with children)
   * @param target branch scope + source master data + actor
   */
  buildImportData(
    source: LabTestWithChildren,
    target: ImportTarget,
  ): Prisma.BranchLabTestUncheckedCreateInput {
    const { scalars, configSnapshot } = this.extractScalars(source);
    return {
      ...scalars,
      tenantId: target.tenantId,
      branchId: target.branchId,
      sourceLabTestId: source.id,
      sourceMasterDataId: target.sourceMasterDataId,
      configSnapshot,
      createdBy: target.actorId,
      updatedBy: target.actorId,
    } as Prisma.BranchLabTestUncheckedCreateInput;
  }

  /**
   * Build the create payload for a duplicate from an existing branch row: copy
   * all fields except the re-derived ones, keep the same variant group
   * (`sourceLabTestId`), and mark it a non-default duplicate with a " (Copy)"
   * display name.
   */
  private buildDuplicateData(
    row: BranchLabTest,
    actorId: string | null,
  ): Prisma.BranchLabTestUncheckedCreateInput {
    const copy: Record<string, unknown> = { ...row };
    for (const key of ['id', 'createdAt', 'updatedAt', 'deletedAt']) {
      delete copy[key];
    }
    return {
      ...copy,
      isDefault: false,
      isDuplicate: true,
      testDisplayName: `${row.testDisplayName ?? row.testName} (Copy)`,
      createdBy: actorId,
      updatedBy: actorId,
    } as Prisma.BranchLabTestUncheckedCreateInput;
  }

  /** Build the overwrite (re-snapshot) update payload from a composed source test. */
  private buildSyncData(
    source: LabTestWithChildren,
    actorId: string | null,
  ): Prisma.BranchLabTestUncheckedUpdateInput {
    const { scalars, configSnapshot } = this.extractScalars(source);
    return {
      ...scalars,
      configSnapshot,
      updatedBy: actorId,
    };
  }

  /**
   * Split a composed source test into its copyable parent scalars and a JSON
   * clinical snapshot. Drops re-derived/scope keys (id, scope, source, versioning,
   * timestamps) and the child arrays (folded into the snapshot instead).
   */
  private extractScalars(source: LabTestWithChildren): {
    scalars: Record<string, unknown>;
    configSnapshot: Prisma.InputJsonValue;
  } {
    const copy: Record<string, unknown> = { ...source };
    const configSnapshot = {
      samples: copy.samples,
      resultParams: copy.resultParams,
    } as unknown as Prisma.InputJsonValue;
    for (const key of BRANCH_TEST_DROP_KEYS) {
      delete copy[key];
    }
    return { scalars: copy, configSnapshot };
  }

  /** Enforce price ordering (min ≤ max ≤ msrp) ahead of the DB CHECK constraints. */
  private assertPriceOrdering(prices: {
    priceMsrp: number;
    priceMaximum: number;
    priceMinimum: number;
  }): void {
    if (prices.priceMaximum > prices.priceMsrp) {
      throw new ValidationException(
        'priceMaximum must be less than or equal to priceMsrp',
      );
    }
    if (prices.priceMinimum > prices.priceMaximum) {
      throw new ValidationException(
        'priceMinimum must be less than or equal to priceMaximum',
      );
    }
  }

  /** Translate the one-default-per-group unique violation into a typed 409. */
  private rethrowConflict(e: unknown): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new BranchLabTestDefaultConflictException();
    }
  }
}
