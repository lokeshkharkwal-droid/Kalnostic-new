import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreatePtCategoryDto } from './dto/create-pt-category.dto';
import { UpdatePtCategoryDto } from './dto/update-pt-category.dto';
import {
  MappedList,
  PtCategoryDefault,
  PtCategoryResolvedLists,
  PtCategoryWithMappings,
} from './entities/pt-category.entity';
import {
  CannotModifyGeneralPtCategoryException,
  InvalidPtCategoryLabPanelListException,
  InvalidPtCategoryLabTestListException,
  PtCategoryMappingRequiredException,
  PtCategoryNameConflictException,
  PtCategoryNotFoundException,
} from './exceptions/pt-category.exceptions';

/** Payload of the `branch.created` event emitted by BranchService. */
interface BranchCreatedEvent {
  tenantId: string;
  branchId: string;
  branchName: string;
}

/** The auto-created default PT category's fixed name (per branch). */
export const GENERAL_PT_CATEGORY_NAME = 'General';

/** A `{ id?, name? }` list option shape (id only, or id+name). */
type ListOption = { id: string; name: string };

/** Include the mapped Lab Test List / Lab Panel List names (id + name). */
const MAPPING_INCLUDE = {
  branchLabTestList: { select: { id: true, name: true } },
  branchLabPanelList: { select: { id: true, name: true } },
} satisfies Prisma.PtCategoryInclude;

type PtCategoryRow = Prisma.PtCategoryGetPayload<{
  include: typeof MAPPING_INCLUDE;
}>;

/** Project a PT category row + its mapped lists into the response shape. */
function toWithMappings(row: PtCategoryRow): PtCategoryWithMappings {
  const { branchLabTestList, branchLabPanelList, ...category } = row;
  const testList: MappedList | null = branchLabTestList
    ? { id: branchLabTestList.id, name: branchLabTestList.name }
    : null;
  const panelList: MappedList | null = branchLabPanelList
    ? { id: branchLabPanelList.id, name: branchLabPanelList.name }
    : null;
  return {
    ...category,
    branchLabTestList: testList,
    branchLabPanelList: panelList,
  };
}

/**
 * PT (Patient) Category management, surfaced on the Registration Settings page.
 * Tenant-scoped + branch-level (CLAUDE.md §4.6/§4.7): each category belongs to
 * one branch and maps to at most one Lab Test List and one Lab Panel List
 * (`BranchLabTestList`/`BranchLabPanelList`) — identical to how referrals map to
 * lists. Every query carries `tenantId` + `branchId` (defence in depth on top of
 * RLS) and filters soft-deleted rows. At most one active default per branch and
 * category-name uniqueness per branch are enforced by partial unique indexes in
 * prisma/rls.sql. Order creation resolves a selected category to its mapped list
 * ids via `getResolvedListIds` (injected into the referral-list resolver — rule
 * #3). A "General" default (unmapped) is auto-provisioned per branch on the
 * `branch.created` event; being unmapped, it never participates in pricing.
 */
@Injectable()
export class PtCategoryService {
  private readonly logger = new Logger(PtCategoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List a branch's PT categories (offset pagination), each with its mapped Lab
   * Test List / Lab Panel List names. Ordered default-first, then oldest-first.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param page 1-based page (default 1)
   * @param limit page size (default 10)
   * @param filters optional case-insensitive `search` (on `categoryName`) and an
   *   active/inactive `status` filter
   */
  async findAllForBranch(
    tenantId: string,
    branchId: string,
    page = 1,
    limit = 10,
    filters: { search?: string; status?: 'ACTIVE' | 'INACTIVE' } = {},
  ): Promise<PaginatedResult<PtCategoryWithMappings>> {
    const where: Prisma.PtCategoryWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
    const search = filters.search?.trim();
    if (search) {
      where.categoryName = { contains: search, mode: 'insensitive' };
    }
    if (filters.status) {
      where.isActive = filters.status === 'ACTIVE';
    }

    const [data, total] = await Promise.all([
      this.prisma.ptCategory.findMany({
        where,
        include: MAPPING_INCLUDE,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.ptCategory.count({ where }),
    ]);
    return { data: data.map(toWithMappings), total, page, limit };
  }

  /**
   * Fetch one active PT category scoped to its tenant/branch, with its mapped
   * Lab Test List / Lab Panel List — for the View/Edit popup.
   * @throws PtCategoryNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<PtCategoryWithMappings> {
    const category = await this.prisma.ptCategory.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
      include: MAPPING_INCLUDE,
    });
    if (!category) {
      throw new PtCategoryNotFoundException(id);
    }
    return toWithMappings(category);
  }

  /**
   * The active default PT category for a branch (id + name), or null if none —
   * used to pre-select the category on the Create-Order page.
   * @param tenantId tenant scope
   * @param branchId active branch
   */
  async findDefaultForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<PtCategoryDefault | null> {
    const row = await this.prisma.ptCategory.findFirst({
      where: {
        tenantId,
        branchId,
        isDefault: true,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, categoryName: true },
    });
    return row ? { id: row.id, categoryName: row.categoryName } : null;
  }

  /**
   * Create a PT category on the caller's active branch. At least one of
   * `branchLabTestListId`/`branchLabPanelListId` is required; both are validated
   * against the active branch. If `isDefault` is true, the branch's previous
   * default is unset in the same transaction.
   * @param tenantId owning tenant
   * @param branchId active branch (scopes the mapping validation + row)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto validated payload
   * @throws PtCategoryMappingRequiredException if neither list is provided
   * @throws InvalidPtCategoryLabTestListException / InvalidPtCategoryLabPanelListException
   * @throws PtCategoryNameConflictException on a name collision
   */
  async create(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: CreatePtCategoryDto,
  ): Promise<PtCategoryWithMappings> {
    if (!dto.branchLabTestListId && !dto.branchLabPanelListId) {
      throw new PtCategoryMappingRequiredException();
    }
    await this.validateMappings(
      tenantId,
      branchId,
      dto.branchLabTestListId,
      dto.branchLabPanelListId,
    );

    try {
      const id = await this.prisma.withTenant(tenantId, async (tx) => {
        if (dto.isDefault) {
          await this.clearDefault(tx, tenantId, branchId);
        }
        const created = await tx.ptCategory.create({
          data: {
            tenantId,
            branchId,
            categoryName: dto.categoryName,
            branchLabTestListId: dto.branchLabTestListId ?? null,
            branchLabPanelListId: dto.branchLabPanelListId ?? null,
            isDefault: dto.isDefault ?? false,
            isActive: dto.isActive ?? true,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
        return created.id;
      });
      return this.findById(id, tenantId, branchId);
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.categoryName);
      throw e;
    }
  }

  /**
   * Update a PT category. A mapping field sent as `null` clears it; omitted
   * leaves it unchanged. At least one mapping must remain after the merge. If
   * `isDefault` is set true, the branch's previous default is unset first.
   * @param id category id
   * @param tenantId tenant scope
   * @param branchId active branch
   * @param actorId person id recorded as updated-by (or null)
   * @param dto partial update
   * @throws PtCategoryNotFoundException if missing/soft-deleted
   * @throws CannotModifyGeneralPtCategoryException if the target is the "General" default
   * @throws PtCategoryMappingRequiredException if the merge leaves no mapping
   * @throws InvalidPtCategoryLabTestListException / InvalidPtCategoryLabPanelListException
   * @throws PtCategoryNameConflictException on a name collision
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: UpdatePtCategoryDto,
  ): Promise<PtCategoryWithMappings> {
    const existing = await this.findById(id, tenantId, branchId);

    // The auto-created "General" default is a fixed, unmapped fallback and must
    // not be edited (mirrors the disabled Edit button in the UI).
    if (existing.categoryName === GENERAL_PT_CATEGORY_NAME) {
      throw new CannotModifyGeneralPtCategoryException(id);
    }

    const nextTestListId =
      dto.branchLabTestListId !== undefined
        ? dto.branchLabTestListId
        : existing.branchLabTestListId;
    const nextPanelListId =
      dto.branchLabPanelListId !== undefined
        ? dto.branchLabPanelListId
        : existing.branchLabPanelListId;
    if (!nextTestListId && !nextPanelListId) {
      throw new PtCategoryMappingRequiredException();
    }
    await this.validateMappings(
      tenantId,
      branchId,
      dto.branchLabTestListId ?? undefined,
      dto.branchLabPanelListId ?? undefined,
    );

    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        if (dto.isDefault) {
          await this.clearDefault(tx, tenantId, branchId, id);
        }
        const data: Prisma.PtCategoryUpdateInput = { updatedBy: actorId };
        if (dto.categoryName !== undefined)
          data.categoryName = dto.categoryName;
        if (dto.isActive !== undefined) data.isActive = dto.isActive;
        if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
        if (dto.branchLabTestListId !== undefined) {
          data.branchLabTestList = dto.branchLabTestListId
            ? { connect: { id: dto.branchLabTestListId } }
            : { disconnect: true };
        }
        if (dto.branchLabPanelListId !== undefined) {
          data.branchLabPanelList = dto.branchLabPanelListId
            ? { connect: { id: dto.branchLabPanelListId } }
            : { disconnect: true };
        }
        await tx.ptCategory.update({ where: { id }, data });
      });
      return this.findById(id, tenantId, branchId);
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.categoryName ?? '');
      throw e;
    }
  }

  /**
   * Activate/inactivate a PT category from the settings table row switch.
   * Inactive categories are excluded from the Create-Order options feed.
   * @throws PtCategoryNotFoundException if missing/soft-deleted
   */
  async setActive(
    id: string,
    tenantId: string,
    branchId: string,
    isActive: boolean,
  ): Promise<PtCategoryWithMappings> {
    await this.findById(id, tenantId, branchId);
    await this.prisma.ptCategory.update({
      where: { id },
      data: { isActive },
    });
    return this.findById(id, tenantId, branchId);
  }

  /**
   * List a branch's ACTIVE PT categories as `{ id, name }` options for the
   * Create-Order dropdown (offset pagination + optional `search`).
   * @param tenantId tenant scope
   * @param branchId active branch
   * @param params page/limit/search
   */
  async findOptions(
    tenantId: string,
    branchId: string,
    params: { page?: number; limit?: number; search?: string },
  ): Promise<PaginatedResult<ListOption>> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where: Prisma.PtCategoryWhereInput = {
      tenantId,
      branchId,
      isActive: true,
      deletedAt: null,
    };
    const search = params.search?.trim();
    if (search) {
      where.categoryName = { contains: search, mode: 'insensitive' };
    }
    const [rows, total] = await Promise.all([
      this.prisma.ptCategory.findMany({
        where,
        select: { id: true, categoryName: true },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ isDefault: 'desc' }, { categoryName: 'asc' }],
      }),
      this.prisma.ptCategory.count({ where }),
    ]);
    const data: ListOption[] = rows.map((r) => ({
      id: r.id,
      name: r.categoryName,
    }));
    return { data, total, page, limit };
  }

  /**
   * Resolve a PT category to its mapped Lab Test List / Lab Panel List ids, for
   * the order pricing chain (injected into the referral-list resolver). Returns
   * null when the category is missing/inactive OR carries no list mapping — the
   * latter covers the auto-created "General" default, so GENERAL never
   * participates in pricing and the resolver falls through to the next priority.
   * @param tenantId tenant scope
   * @param branchId active branch
   * @param ptCategoryId the selected category id
   */
  async getResolvedListIds(
    tenantId: string,
    branchId: string,
    ptCategoryId: string,
  ): Promise<PtCategoryResolvedLists | null> {
    const category = await this.prisma.ptCategory.findFirst({
      where: {
        id: ptCategoryId,
        tenantId,
        branchId,
        isActive: true,
        deletedAt: null,
      },
      select: { branchLabTestListId: true, branchLabPanelListId: true },
    });
    if (
      !category ||
      (!category.branchLabTestListId && !category.branchLabPanelListId)
    ) {
      return null;
    }
    return {
      branchLabTestListId: category.branchLabTestListId,
      branchLabPanelListId: category.branchLabPanelListId,
    };
  }

  /**
   * React to a branch being created by auto-provisioning that branch's default
   * "General" PT category (unmapped). Idempotent — a no-op if the branch already
   * has any active PT category — so a redelivered event is safe. Runs outside a
   * request, so all work goes through `withTenant` to set the RLS tenant context.
   * Errors are logged and swallowed: a failed provision must never fail the
   * already-committed branch creation.
   * @param payload the `branch.created` event
   */
  @OnEvent('branch.created')
  async handleBranchCreated(payload: BranchCreatedEvent): Promise<void> {
    try {
      await this.createDefaultForBranch(payload.tenantId, payload.branchId);
    } catch (e) {
      this.logger.error(
        `Failed to auto-create default PT category for branch ${
          payload.branchId
        }: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Create the branch's default "General" PT category (unmapped, active) if it
   * has none. Used by the `branch.created` handler. Idempotent via an existence
   * check + swallowed unique-constraint race.
   * @param tenantId owning tenant
   * @param branchId the branch to provision
   */
  async createDefaultForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<void> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.ptCategory.findFirst({
        where: { tenantId, branchId, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        return;
      }
      try {
        await tx.ptCategory.create({
          data: {
            tenantId,
            branchId,
            categoryName: GENERAL_PT_CATEGORY_NAME,
            isDefault: true,
            isActive: true,
          },
        });
      } catch (e) {
        if (
          !(e instanceof Prisma.PrismaClientKnownRequestError) ||
          e.code !== 'P2002'
        ) {
          throw e;
        }
      }
    });
  }

  /**
   * Unset the branch's current default category (if any), excluding `exceptId`
   * when supplied (so re-confirming the already-default category is a no-op).
   */
  private async clearDefault(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    exceptId?: string,
  ): Promise<void> {
    await tx.ptCategory.updateMany({
      where: {
        tenantId,
        branchId,
        isDefault: true,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  /**
   * Verify each supplied list id resolves to an active Lab Test List / Lab Panel
   * List in the caller's active branch. Skips ids that are undefined/null.
   * @throws InvalidPtCategoryLabTestListException / InvalidPtCategoryLabPanelListException
   */
  private async validateMappings(
    tenantId: string,
    branchId: string,
    branchLabTestListId?: string,
    branchLabPanelListId?: string,
  ): Promise<void> {
    if (branchLabTestListId) {
      const list = await this.prisma.branchLabTestList.findFirst({
        where: {
          id: branchLabTestListId,
          tenantId,
          branchId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!list) {
        throw new InvalidPtCategoryLabTestListException(branchLabTestListId);
      }
    }
    if (branchLabPanelListId) {
      const list = await this.prisma.branchLabPanelList.findFirst({
        where: {
          id: branchLabPanelListId,
          tenantId,
          branchId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!list) {
        throw new InvalidPtCategoryLabPanelListException(branchLabPanelListId);
      }
    }
  }

  /**
   * If the caught error is a Prisma unique-constraint violation (P2002) on the
   * (tenant, branch, name) index, throw the typed 409. Returns normally
   * otherwise so the caller can rethrow.
   * @throws PtCategoryNameConflictException
   */
  private rethrowUniqueViolation(e: unknown, name: string): void {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== 'P2002'
    ) {
      return;
    }
    throw new PtCategoryNameConflictException(name);
  }
}
