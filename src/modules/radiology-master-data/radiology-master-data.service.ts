import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Prisma,
  RadiologyMasterData,
  RadiologyPanel,
  RadiologyTest,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { CreateRadiologyMasterDataDto } from './dto/create-radiology-master-data.dto';
import { UpdateRadiologyMasterDataDto } from './dto/update-radiology-master-data.dto';
import {
  BranchAlreadyHasRadiologyMasterDataException,
  CannotDeleteMainBranchRadiologyMasterDataException,
  RadiologyMasterDataNameConflictException,
  RadiologyMasterDataNotFoundException,
  RadiologyMasterDataNotMappedToBranchException,
} from './exceptions/radiology-master-data.exceptions';

/** Payload of the `branch.created` event emitted by BranchService. */
interface BranchCreatedEvent {
  tenantId: string;
  branchId: string;
  branchName: string;
}

/** Fixed name of the tenant-level Tenant Radiology Master Data singleton. */
export const TENANT_RADIOLOGY_MASTER_DATA_NAME = 'Tenant Radiology Master Data';

/** A {@link RadiologyTest} row enriched with its resolved classification names. */
export type ImportableRadiologyTestRow = RadiologyTest & {
  departmentName: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
};

/** A {@link RadiologyPanel} row enriched with its resolved classification names.
 * Panels have no sub-category (unlike RadiologyTest). */
export type ImportableRadiologyPanelRow = RadiologyPanel & {
  departmentName: string | null;
  categoryName: string | null;
};

/**
 * Radiology master-data management. Tenant-scoped + branch-level (CLAUDE.md §4.6).
 * Every query carries `tenantId` (defence in depth on top of RLS, §4.3) and
 * filters soft-deleted rows. A non-main branch may hold several master data; the
 * main branch is capped at its single auto-created default. Radiology tests inside
 * a master data are owned by the radiology-test module.
 */
@Injectable()
export class RadiologyMasterDataService {
  private readonly logger = new Logger(RadiologyMasterDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * React to a branch being created by auto-provisioning that branch's default
   * radiology master data (named after the branch). Idempotent — does nothing if
   * the branch already has an active master data. Runs outside a request, so all
   * work goes through `withTenant` to set the RLS tenant context. Errors are
   * logged and swallowed so a failed auto-provision never fails branch creation.
   * @param payload the `branch.created` event
   */
  @OnEvent('branch.created')
  async handleBranchCreated(payload: BranchCreatedEvent): Promise<void> {
    try {
      await this.createDefaultForBranch(
        payload.tenantId,
        payload.branchId,
        payload.branchName,
      );
    } catch (e) {
      this.logger.error(
        `Failed to auto-create radiology master data for branch ${
          payload.branchId
        }: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Create the default radiology master data for a branch if it has none. Used by
   * the `branch.created` handler. Idempotent via an existence check in the same
   * transaction.
   * @param tenantId owning tenant
   * @param branchId the branch to provision
   * @param branchName seeds the master data's name
   * @returns the created master data, or null if one already existed
   */
  async createDefaultForBranch(
    tenantId: string,
    branchId: string,
    branchName: string,
  ): Promise<RadiologyMasterData | null> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.radiologyMasterData.count({
        where: { tenantId, branchId, deletedAt: null },
      });
      if (existing > 0) {
        return null;
      }
      return tx.radiologyMasterData.create({
        data: { tenantId, branchId, name: branchName, description: null },
      });
    });
  }

  /**
   * Manually create a radiology master data for a branch. The branch is validated
   * to belong to the caller's tenant (CLAUDE.md §4.7). A branch maps to **exactly
   * one** master data (1:1), so creation is rejected when the branch already has
   * an active one.
   * @param tenantId owning tenant
   * @param dto validated payload (branchId, name, optional description)
   * @returns the created master data
   * @throws BranchNotFoundException if the branch is missing/other tenant
   * @throws BranchAlreadyHasRadiologyMasterDataException if the branch already has one
   * @throws RadiologyMasterDataNameConflictException if the name is taken on this branch
   */
  async create(
    tenantId: string,
    dto: CreateRadiologyMasterDataDto,
  ): Promise<RadiologyMasterData> {
    await this.branchService.findById(dto.branchId, tenantId);

    const existing = await this.prisma.radiologyMasterData.count({
      where: { tenantId, branchId: dto.branchId, deletedAt: null },
    });
    if (existing > 0) {
      throw new BranchAlreadyHasRadiologyMasterDataException(dto.branchId);
    }

    try {
      return await this.prisma.radiologyMasterData.create({
        data: {
          tenantId,
          branchId: dto.branchId,
          name: dto.name,
          description: dto.description ?? null,
        },
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new RadiologyMasterDataNameConflictException(dto.name);
      }
      throw e;
    }
  }

  /**
   * Fetch one active radiology master data scoped to its tenant.
   * @param id master data id
   * @param tenantId tenant scope
   * @throws RadiologyMasterDataNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<RadiologyMasterData> {
    const masterData = await this.prisma.radiologyMasterData.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!masterData) {
      throw new RadiologyMasterDataNotFoundException(id);
    }
    return masterData;
  }

  /**
   * Resolve the single active radiology master data mapped to a branch (the 1:1
   * pointer). The branch is validated to belong to the caller's tenant first (§4.7).
   * @param branchId the branch whose master data to resolve
   * @param tenantId tenant scope
   * @throws BranchNotFoundException if the branch is missing/other tenant
   * @throws RadiologyMasterDataNotMappedToBranchException if the branch has none
   */
  async findByBranch(
    branchId: string,
    tenantId: string,
  ): Promise<RadiologyMasterData> {
    await this.branchService.findById(branchId, tenantId);
    const masterData = await this.prisma.radiologyMasterData.findFirst({
      where: { branchId, tenantId, deletedAt: null },
    });
    if (!masterData) {
      throw new RadiologyMasterDataNotMappedToBranchException(branchId);
    }
    return masterData;
  }

  /**
   * Resolve (creating on first access) the tenant-level **Tenant Radiology Master
   * Data** singleton — the one master data with no branch (`branchId = NULL`). This
   * is the destination for Site Admin imports and the source for Tenant→Branch sync.
   * @param tenantId tenant scope
   */
  async getOrCreateTenantMasterData(
    tenantId: string,
  ): Promise<RadiologyMasterData> {
    const existing = await this.prisma.radiologyMasterData.findFirst({
      where: { tenantId, branchId: null, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.radiologyMasterData.create({
        data: {
          tenantId,
          branchId: null,
          name: TENANT_RADIOLOGY_MASTER_DATA_NAME,
          description: null,
        },
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        const created = await this.prisma.radiologyMasterData.findFirst({
          where: { tenantId, branchId: null, deletedAt: null },
        });
        if (created) {
          return created;
        }
      }
      throw e;
    }
  }

  /**
   * Resolve (creating on first access) a branch's single **Branch Radiology Master
   * Data**. Reuses `findByBranch`, falling back to auto-provisioning. Validates the
   * branch belongs to the tenant first (§4.7).
   * @param tenantId tenant scope
   * @param branchId the branch whose master data to resolve
   */
  async getOrCreateBranchMasterData(
    tenantId: string,
    branchId: string,
  ): Promise<RadiologyMasterData> {
    const branch = await this.branchService.findById(branchId, tenantId);
    const existing = await this.prisma.radiologyMasterData.findFirst({
      where: { branchId, tenantId, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    const created = await this.createDefaultForBranch(
      tenantId,
      branchId,
      branch.name,
    );
    return created ?? this.findByBranch(branchId, tenantId);
  }

  /**
   * Build the `RadiologyTest` `where` clause shared by {@link getImportableTests}
   * (paginated listing) and `BranchRadiologyTestService.importFromMasterDataByFilter`
   * (bulk "select all" import) — both must match the identical set of rows.
   * @param masterDataId source master data
   * @param tenantId tenant scope
   * @param search optional case-insensitive `testName`/`testCode` match
   * @param classificationFilters optional department/category/sub-category name filters
   * @param excludeListId excludes tests already in this `BranchRadiologyTestList`
   */
  async buildImportableTestWhere(
    masterDataId: string,
    tenantId: string,
    search?: string,
    classificationFilters: {
      department?: string;
      category?: string;
      subCategory?: string;
    } = {},
    excludeListId?: string,
  ): Promise<Prisma.RadiologyTestWhereInput> {
    const where: Prisma.RadiologyTestWhereInput = {
      masterDataId,
      tenantId,
      deletedAt: null,
    };
    if (excludeListId) {
      const existing = await this.prisma.branchRadiologyTest.findMany({
        where: {
          tenantId,
          listId: excludeListId,
          deletedAt: null,
          sourceLabTestId: { not: null },
        },
        select: { sourceLabTestId: true },
      });
      const existingIds = existing
        .map((r) => r.sourceLabTestId)
        .filter((x): x is string => Boolean(x));
      if (existingIds.length > 0) {
        where.id = { notIn: existingIds };
      }
    }
    const term = search?.trim();
    if (term) {
      where.OR = [
        { testName: { contains: term, mode: 'insensitive' } },
        { testCode: { contains: term, mode: 'insensitive' } },
      ];
    }
    // Classification ids on RadiologyTest are logical refs (no Prisma relation) —
    // resolve matching ids first, then filter on the plain id column.
    const dept = classificationFilters.department?.trim();
    if (dept) {
      where.departmentId = {
        in: await this.classificationIds('department', tenantId, dept),
      };
    }
    const cat = classificationFilters.category?.trim();
    if (cat) {
      where.categoryId = {
        in: await this.classificationIds('category', tenantId, cat),
      };
    }
    const subCat = classificationFilters.subCategory?.trim();
    if (subCat) {
      where.subCategoryId = {
        in: await this.classificationIds('subCategory', tenantId, subCat),
      };
    }
    return where;
  }

  /**
   * Import source: the active radiology tests of the master data mapped to
   * `branchId`. Resolves the branch's master data (1:1), then returns its tests
   * paginated for selection. Read-only.
   * @param branchId active branch (from the JWT, supplied by the client)
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param search optional case-insensitive match on `testName`/`testCode`
   * @param classificationFilters optional classification name filters
   * @param excludeListId excludes tests already in this list
   * @throws RadiologyMasterDataNotMappedToBranchException if the branch has none
   */
  async getImportableTests(
    branchId: string,
    tenantId: string,
    page = 1,
    limit = 20,
    search?: string,
    classificationFilters: {
      department?: string;
      category?: string;
      subCategory?: string;
    } = {},
    excludeListId?: string,
  ): Promise<PaginatedResult<ImportableRadiologyTestRow>> {
    const masterData = await this.findByBranch(branchId, tenantId);
    const where = await this.buildImportableTestWhere(
      masterData.id,
      tenantId,
      search,
      classificationFilters,
      excludeListId,
    );
    const data = await this.prisma.radiologyTest.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { testName: 'asc' },
    });
    const total = await this.prisma.radiologyTest.count({ where });
    const [deptNames, catNames, subCatNames] = await Promise.all([
      this.resolveClassificationNames(
        'department',
        tenantId,
        data.map((t) => t.departmentId),
      ),
      this.resolveClassificationNames(
        'category',
        tenantId,
        data.map((t) => t.categoryId),
      ),
      this.resolveClassificationNames(
        'subCategory',
        tenantId,
        data.map((t) => t.subCategoryId),
      ),
    ]);
    const enriched: ImportableRadiologyTestRow[] = data.map((t) => ({
      ...t,
      departmentName: this.nameOfClassification(deptNames, t.departmentId),
      categoryName: this.nameOfClassification(catNames, t.categoryId),
      subCategoryName: this.nameOfClassification(subCatNames, t.subCategoryId),
    }));
    return { data: enriched, total, page, limit };
  }

  /**
   * Build the `RadiologyPanel` `where` clause shared by {@link getImportablePanels}
   * and the bulk panel import.
   * @param masterDataId source master data
   * @param tenantId tenant scope
   * @param search optional case-insensitive `panelName`/`panelCode` match
   * @param classificationFilters optional department/category name filters
   * @param excludeListId excludes panels already in this `BranchRadiologyPanelList`
   */
  async buildImportablePanelWhere(
    masterDataId: string,
    tenantId: string,
    search?: string,
    classificationFilters: { department?: string; category?: string } = {},
    excludeListId?: string,
  ): Promise<Prisma.RadiologyPanelWhereInput> {
    const where: Prisma.RadiologyPanelWhereInput = {
      masterDataId,
      tenantId,
      deletedAt: null,
    };
    if (excludeListId) {
      const existing = await this.prisma.branchRadiologyPanel.findMany({
        where: {
          tenantId,
          listId: excludeListId,
          deletedAt: null,
          sourceLabPanelId: { not: null },
        },
        select: { sourceLabPanelId: true },
      });
      const existingIds = existing
        .map((r) => r.sourceLabPanelId)
        .filter((x): x is string => Boolean(x));
      if (existingIds.length > 0) {
        where.id = { notIn: existingIds };
      }
    }
    const term = search?.trim();
    if (term) {
      where.OR = [
        { panelName: { contains: term, mode: 'insensitive' } },
        { panelCode: { contains: term, mode: 'insensitive' } },
      ];
    }
    const dept = classificationFilters.department?.trim();
    if (dept) {
      where.departmentId = {
        in: await this.classificationIds('department', tenantId, dept),
      };
    }
    const cat = classificationFilters.category?.trim();
    if (cat) {
      where.categoryId = {
        in: await this.classificationIds('category', tenantId, cat),
      };
    }
    return where;
  }

  /**
   * Import source: the active radiology panels of the master data mapped to
   * `branchId`. Mirrors {@link getImportableTests}.
   * @param branchId active branch (from the JWT, supplied by the client)
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param search optional case-insensitive match on `panelName`/`panelCode`
   * @param classificationFilters optional department/category name filters
   * @param excludeListId excludes panels already in this list
   * @throws RadiologyMasterDataNotMappedToBranchException if the branch has none
   */
  async getImportablePanels(
    branchId: string,
    tenantId: string,
    page = 1,
    limit = 20,
    search?: string,
    classificationFilters: { department?: string; category?: string } = {},
    excludeListId?: string,
  ): Promise<PaginatedResult<ImportableRadiologyPanelRow>> {
    const masterData = await this.findByBranch(branchId, tenantId);
    const where = await this.buildImportablePanelWhere(
      masterData.id,
      tenantId,
      search,
      classificationFilters,
      excludeListId,
    );
    const data = await this.prisma.radiologyPanel.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { panelName: 'asc' },
    });
    const total = await this.prisma.radiologyPanel.count({ where });
    const [deptNames, catNames] = await Promise.all([
      this.resolveClassificationNames(
        'department',
        tenantId,
        data.map((p) => p.departmentId),
      ),
      this.resolveClassificationNames(
        'category',
        tenantId,
        data.map((p) => p.categoryId),
      ),
    ]);
    const enriched: ImportableRadiologyPanelRow[] = data.map((p) => ({
      ...p,
      departmentName: this.nameOfClassification(deptNames, p.departmentId),
      categoryName: this.nameOfClassification(catNames, p.categoryId),
    }));
    return { data: enriched, total, page, limit };
  }

  /**
   * Resolve the tenant-scoped ids of a classification model whose name matches
   * (case-insensitive) the given term. Used to translate a name filter into an
   * `in` filter on the plain logical-ref id column.
   * @param model which classification model to search
   * @param tenantId tenant scope
   * @param term case-insensitive name fragment
   */
  private async classificationIds(
    model: 'department' | 'category' | 'subCategory',
    tenantId: string,
    term: string,
  ): Promise<string[]> {
    const where = {
      tenantId,
      name: { contains: term, mode: 'insensitive' as const },
    };
    const select = { id: true };
    const rows =
      model === 'department'
        ? await this.prisma.department.findMany({ where, select })
        : model === 'category'
          ? await this.prisma.category.findMany({ where, select })
          : await this.prisma.subCategory.findMany({ where, select });
    return rows.map((r) => r.id);
  }

  /**
   * Resolve a set of classification ids to an `id → name` map (tenant-scoped).
   * @param model which classification model to read
   * @param tenantId tenant scope
   * @param idsRaw the (possibly null) ids to resolve
   */
  private async resolveClassificationNames(
    model: 'department' | 'category' | 'subCategory',
    tenantId: string,
    idsRaw: (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(idsRaw.filter((x): x is string => Boolean(x)))];
    const map = new Map<string, string>();
    if (ids.length === 0) {
      return map;
    }
    const where = { id: { in: ids }, tenantId };
    const select = { id: true, name: true };
    const rows =
      model === 'department'
        ? await this.prisma.department.findMany({ where, select })
        : model === 'category'
          ? await this.prisma.category.findMany({ where, select })
          : await this.prisma.subCategory.findMany({ where, select });
    for (const r of rows) {
      map.set(r.id, r.name);
    }
    return map;
  }

  /** Look up a resolved classification name by (possibly null) id. */
  private nameOfClassification(
    map: Map<string, string>,
    id: string | null,
  ): string | null {
    return id ? (map.get(id) ?? null) : null;
  }

  /**
   * List active per-branch radiology master data for a tenant (offset pagination).
   * The tenant-level Tenant Radiology Master Data (branchId NULL) is fetched via
   * its dedicated endpoint and never appears here.
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive name `search` and a `branchId` filter
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
    filters: { search?: string; branchId?: string } = {},
  ): Promise<PaginatedResult<RadiologyMasterData>> {
    const where: Prisma.RadiologyMasterDataWhereInput = {
      tenantId,
      branchId: { not: null },
      deletedAt: null,
    };
    const search = filters.search?.trim();
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    const data = await this.prisma.radiologyMasterData.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.radiologyMasterData.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update a radiology master data's name/description. `branchId` is immutable.
   * @param id master data id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws RadiologyMasterDataNotFoundException if missing/soft-deleted
   * @throws RadiologyMasterDataNameConflictException if the new name collides
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateRadiologyMasterDataDto,
  ): Promise<RadiologyMasterData> {
    await this.findById(id, tenantId);
    const data: Prisma.RadiologyMasterDataUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined)
      data.description = dto.description ?? null;
    try {
      return await this.prisma.radiologyMasterData.update({
        where: { id },
        data,
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new RadiologyMasterDataNameConflictException(dto.name ?? '');
      }
      throw e;
    }
  }

  /**
   * Soft-delete a radiology master data and cascade soft-delete its active tests
   * and all of their children (samples, params, reference ranges/values) in one
   * transaction. Master data belonging to the tenant's main branch cannot be deleted.
   * @param id master data id
   * @param tenantId tenant scope
   * @throws RadiologyMasterDataNotFoundException if missing/soft-deleted
   * @throws CannotDeleteMainBranchRadiologyMasterDataException if it belongs to the main branch
   */
  async remove(id: string, tenantId: string): Promise<RadiologyMasterData> {
    const masterData = await this.findById(id, tenantId);
    if (
      masterData.branchId &&
      (await this.isMainBranch(tenantId, masterData.branchId))
    ) {
      throw new CannotDeleteMainBranchRadiologyMasterDataException(id);
    }
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      const tests = await tx.radiologyTest.findMany({
        where: { masterDataId: id, tenantId, deletedAt: null },
        select: { id: true },
      });
      const testIds = tests.map((t) => t.id);
      if (testIds.length) {
        const childWhere = {
          labTestId: { in: testIds },
          tenantId,
          deletedAt: null,
        };
        await tx.radiologyTestReferenceRange.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.radiologyTestReferenceValue.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.radiologyTestResultParam.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.radiologyTestSample.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.radiologyTest.updateMany({
          where: { id: { in: testIds }, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
      }
      return tx.radiologyMasterData.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Whether `branchId` is the tenant's current main branch (reads the single
   * `TenantMainBranch` pointer).
   * @param tenantId tenant scope
   * @param branchId the branch to check
   */
  private async isMainBranch(
    tenantId: string,
    branchId: string,
  ): Promise<boolean> {
    const pointer = await this.prisma.tenantMainBranch.findUnique({
      where: { tenantId },
    });
    return pointer?.branchId === branchId;
  }

  /**
   * Narrow an unknown caught error to a Prisma unique-constraint violation (P2002).
   * @param e the caught error
   */
  private isUniqueViolation(
    e: unknown,
  ): e is Prisma.PrismaClientKnownRequestError {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    );
  }
}
