import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma, OpdMasterData, OpdPanel, OpdTest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { CreateOpdMasterDataDto } from './dto/create-opd-master-data.dto';
import { UpdateOpdMasterDataDto } from './dto/update-opd-master-data.dto';
import {
  BranchAlreadyHasOpdMasterDataException,
  CannotDeleteMainBranchOpdMasterDataException,
  OpdMasterDataNameConflictException,
  OpdMasterDataNotFoundException,
  OpdMasterDataNotMappedToBranchException,
} from './exceptions/opd-master-data.exceptions';

/** Payload of the `branch.created` event emitted by BranchService. */
interface BranchCreatedEvent {
  tenantId: string;
  branchId: string;
  branchName: string;
}

/** Fixed name of the tenant-level Tenant Opd Master Data singleton. */
export const TENANT_OPD_MASTER_DATA_NAME = 'Tenant Opd Master Data';

/** A {@link OpdTest} row enriched with its resolved classification names. */
export type ImportableOpdTestRow = OpdTest & {
  departmentName: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
};

/** A {@link OpdPanel} row enriched with its resolved classification names.
 * Panels have no sub-category (unlike OpdTest). */
export type ImportableOpdPanelRow = OpdPanel & {
  departmentName: string | null;
  categoryName: string | null;
};

/**
 * Opd master-data management. Tenant-scoped + branch-level (CLAUDE.md §4.6).
 * Every query carries `tenantId` (defence in depth on top of RLS, §4.3) and
 * filters soft-deleted rows. A non-main branch may hold several master data; the
 * main branch is capped at its single auto-created default. Opd tests inside
 * a master data are owned by the opd-test module.
 */
@Injectable()
export class OpdMasterDataService {
  private readonly logger = new Logger(OpdMasterDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * React to a branch being created by auto-provisioning that branch's default
   * opd master data (named after the branch). Idempotent — does nothing if
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
        `Failed to auto-create opd master data for branch ${
          payload.branchId
        }: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Create the default opd master data for a branch if it has none. Used by
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
  ): Promise<OpdMasterData | null> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.opdMasterData.count({
        where: { tenantId, branchId, deletedAt: null },
      });
      if (existing > 0) {
        return null;
      }
      return tx.opdMasterData.create({
        data: { tenantId, branchId, name: branchName, description: null },
      });
    });
  }

  /**
   * Manually create a opd master data for a branch. The branch is validated
   * to belong to the caller's tenant (CLAUDE.md §4.7). A branch maps to **exactly
   * one** master data (1:1), so creation is rejected when the branch already has
   * an active one.
   * @param tenantId owning tenant
   * @param dto validated payload (branchId, name, optional description)
   * @returns the created master data
   * @throws BranchNotFoundException if the branch is missing/other tenant
   * @throws BranchAlreadyHasOpdMasterDataException if the branch already has one
   * @throws OpdMasterDataNameConflictException if the name is taken on this branch
   */
  async create(
    tenantId: string,
    dto: CreateOpdMasterDataDto,
  ): Promise<OpdMasterData> {
    await this.branchService.findById(dto.branchId, tenantId);

    const existing = await this.prisma.opdMasterData.count({
      where: { tenantId, branchId: dto.branchId, deletedAt: null },
    });
    if (existing > 0) {
      throw new BranchAlreadyHasOpdMasterDataException(dto.branchId);
    }

    try {
      return await this.prisma.opdMasterData.create({
        data: {
          tenantId,
          branchId: dto.branchId,
          name: dto.name,
          description: dto.description ?? null,
        },
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new OpdMasterDataNameConflictException(dto.name);
      }
      throw e;
    }
  }

  /**
   * Fetch one active opd master data scoped to its tenant.
   * @param id master data id
   * @param tenantId tenant scope
   * @throws OpdMasterDataNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<OpdMasterData> {
    const masterData = await this.prisma.opdMasterData.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!masterData) {
      throw new OpdMasterDataNotFoundException(id);
    }
    return masterData;
  }

  /**
   * Resolve the single active opd master data mapped to a branch (the 1:1
   * pointer). The branch is validated to belong to the caller's tenant first (§4.7).
   * @param branchId the branch whose master data to resolve
   * @param tenantId tenant scope
   * @throws BranchNotFoundException if the branch is missing/other tenant
   * @throws OpdMasterDataNotMappedToBranchException if the branch has none
   */
  async findByBranch(
    branchId: string,
    tenantId: string,
  ): Promise<OpdMasterData> {
    await this.branchService.findById(branchId, tenantId);
    const masterData = await this.prisma.opdMasterData.findFirst({
      where: { branchId, tenantId, deletedAt: null },
    });
    if (!masterData) {
      throw new OpdMasterDataNotMappedToBranchException(branchId);
    }
    return masterData;
  }

  /**
   * Resolve (creating on first access) the tenant-level **Tenant Opd Master
   * Data** singleton — the one master data with no branch (`branchId = NULL`). This
   * is the destination for Site Admin imports and the source for Tenant→Branch sync.
   * @param tenantId tenant scope
   */
  async getOrCreateTenantMasterData(tenantId: string): Promise<OpdMasterData> {
    const existing = await this.prisma.opdMasterData.findFirst({
      where: { tenantId, branchId: null, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.opdMasterData.create({
        data: {
          tenantId,
          branchId: null,
          name: TENANT_OPD_MASTER_DATA_NAME,
          description: null,
        },
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        const created = await this.prisma.opdMasterData.findFirst({
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
   * Resolve (creating on first access) a branch's single **Branch Opd Master
   * Data**. Reuses `findByBranch`, falling back to auto-provisioning. Validates the
   * branch belongs to the tenant first (§4.7).
   * @param tenantId tenant scope
   * @param branchId the branch whose master data to resolve
   */
  async getOrCreateBranchMasterData(
    tenantId: string,
    branchId: string,
  ): Promise<OpdMasterData> {
    const branch = await this.branchService.findById(branchId, tenantId);
    const existing = await this.prisma.opdMasterData.findFirst({
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
   * Build the `OpdTest` `where` clause shared by {@link getImportableTests}
   * (paginated listing) and `BranchOpdTestService.importFromMasterDataByFilter`
   * (bulk "select all" import) — both must match the identical set of rows.
   * @param masterDataId source master data
   * @param tenantId tenant scope
   * @param search optional case-insensitive `testName`/`testCode` match
   * @param classificationFilters optional department/category/sub-category name filters
   * @param excludeListId excludes tests already in this `BranchOpdTestList`
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
  ): Promise<Prisma.OpdTestWhereInput> {
    const where: Prisma.OpdTestWhereInput = {
      masterDataId,
      tenantId,
      deletedAt: null,
    };
    if (excludeListId) {
      const existing = await this.prisma.branchOpdTest.findMany({
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
    // Classification ids on OpdTest are logical refs (no Prisma relation) —
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
   * Import source: the active opd tests of the master data mapped to
   * `branchId`. Resolves the branch's master data (1:1), then returns its tests
   * paginated for selection. Read-only.
   * @param branchId active branch (from the JWT, supplied by the client)
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param search optional case-insensitive match on `testName`/`testCode`
   * @param classificationFilters optional classification name filters
   * @param excludeListId excludes tests already in this list
   * @throws OpdMasterDataNotMappedToBranchException if the branch has none
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
  ): Promise<PaginatedResult<ImportableOpdTestRow>> {
    const masterData = await this.findByBranch(branchId, tenantId);
    const where = await this.buildImportableTestWhere(
      masterData.id,
      tenantId,
      search,
      classificationFilters,
      excludeListId,
    );
    const data = await this.prisma.opdTest.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { testName: 'asc' },
    });
    const total = await this.prisma.opdTest.count({ where });
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
    const enriched: ImportableOpdTestRow[] = data.map((t) => ({
      ...t,
      departmentName: this.nameOfClassification(deptNames, t.departmentId),
      categoryName: this.nameOfClassification(catNames, t.categoryId),
      subCategoryName: this.nameOfClassification(subCatNames, t.subCategoryId),
    }));
    return { data: enriched, total, page, limit };
  }

  /**
   * Build the `OpdPanel` `where` clause shared by {@link getImportablePanels}
   * and the bulk panel import.
   * @param masterDataId source master data
   * @param tenantId tenant scope
   * @param search optional case-insensitive `panelName`/`panelCode` match
   * @param classificationFilters optional department/category name filters
   * @param excludeListId excludes panels already in this `BranchOpdPanelList`
   */
  async buildImportablePanelWhere(
    masterDataId: string,
    tenantId: string,
    search?: string,
    classificationFilters: { department?: string; category?: string } = {},
    excludeListId?: string,
  ): Promise<Prisma.OpdPanelWhereInput> {
    const where: Prisma.OpdPanelWhereInput = {
      masterDataId,
      tenantId,
      deletedAt: null,
    };
    if (excludeListId) {
      const existing = await this.prisma.branchOpdPanel.findMany({
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
   * Import source: the active opd panels of the master data mapped to
   * `branchId`. Mirrors {@link getImportableTests}.
   * @param branchId active branch (from the JWT, supplied by the client)
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param search optional case-insensitive match on `panelName`/`panelCode`
   * @param classificationFilters optional department/category name filters
   * @param excludeListId excludes panels already in this list
   * @throws OpdMasterDataNotMappedToBranchException if the branch has none
   */
  async getImportablePanels(
    branchId: string,
    tenantId: string,
    page = 1,
    limit = 20,
    search?: string,
    classificationFilters: { department?: string; category?: string } = {},
    excludeListId?: string,
  ): Promise<PaginatedResult<ImportableOpdPanelRow>> {
    const masterData = await this.findByBranch(branchId, tenantId);
    const where = await this.buildImportablePanelWhere(
      masterData.id,
      tenantId,
      search,
      classificationFilters,
      excludeListId,
    );
    const data = await this.prisma.opdPanel.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { panelName: 'asc' },
    });
    const total = await this.prisma.opdPanel.count({ where });
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
    const enriched: ImportableOpdPanelRow[] = data.map((p) => ({
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
   * List active per-branch opd master data for a tenant (offset pagination).
   * The tenant-level Tenant Opd Master Data (branchId NULL) is fetched via
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
  ): Promise<PaginatedResult<OpdMasterData>> {
    const where: Prisma.OpdMasterDataWhereInput = {
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
    const data = await this.prisma.opdMasterData.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.opdMasterData.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update a opd master data's name/description. `branchId` is immutable.
   * @param id master data id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws OpdMasterDataNotFoundException if missing/soft-deleted
   * @throws OpdMasterDataNameConflictException if the new name collides
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateOpdMasterDataDto,
  ): Promise<OpdMasterData> {
    await this.findById(id, tenantId);
    const data: Prisma.OpdMasterDataUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined)
      data.description = dto.description ?? null;
    try {
      return await this.prisma.opdMasterData.update({
        where: { id },
        data,
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new OpdMasterDataNameConflictException(dto.name ?? '');
      }
      throw e;
    }
  }

  /**
   * Soft-delete a opd master data and cascade soft-delete its active tests
   * and all of their children (samples, params, reference ranges/values) in one
   * transaction. Master data belonging to the tenant's main branch cannot be deleted.
   * @param id master data id
   * @param tenantId tenant scope
   * @throws OpdMasterDataNotFoundException if missing/soft-deleted
   * @throws CannotDeleteMainBranchOpdMasterDataException if it belongs to the main branch
   */
  async remove(id: string, tenantId: string): Promise<OpdMasterData> {
    const masterData = await this.findById(id, tenantId);
    if (
      masterData.branchId &&
      (await this.isMainBranch(tenantId, masterData.branchId))
    ) {
      throw new CannotDeleteMainBranchOpdMasterDataException(id);
    }
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      const tests = await tx.opdTest.findMany({
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
        await tx.opdTestReferenceRange.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.opdTestReferenceValue.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.opdTestResultParam.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.opdTestSample.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.opdTest.updateMany({
          where: { id: { in: testIds }, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
      }
      return tx.opdMasterData.update({
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
