import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreatePatientCategoryDto } from './dto/create-patient-category.dto';
import { UpdatePatientCategoryDto } from './dto/update-patient-category.dto';
import {
  LabListOption,
  PatientCategoryWithLists,
} from './entities/patient-category.entity';
import {
  CannotDeactivateDefaultCategoryException,
  InactiveCategoryCannotBeDefaultException,
  InvalidLabPanelSelectionException,
  InvalidLabTestSelectionException,
  PatientCategoryNameConflictException,
  PatientCategoryNotFoundException,
} from './exceptions/patient-category.exceptions';

/** The default category's fixed name, bootstrapped for every tenant. */
const GENERAL_CATEGORY_NAME = 'General';

/** Include the branch's mapped lab test/panel names (id + display name only). */
function mappingsInclude(branchId: string) {
  return {
    labTestMappings: {
      where: { branchId },
      include: { branchLabTest: { select: { id: true, testName: true } } },
    },
    labPanelMappings: {
      where: { branchId },
      include: { branchLabPanel: { select: { id: true, panelName: true } } },
    },
  } satisfies Prisma.PatientCategoryDefinitionInclude;
}

type CategoryWithRawMappings = Prisma.PatientCategoryDefinitionGetPayload<{
  include: ReturnType<typeof mappingsInclude>;
}>;

/** Project a category + its raw mapping rows into `{ id, name }` list options. */
function toWithLists(row: CategoryWithRawMappings): PatientCategoryWithLists {
  const { labTestMappings, labPanelMappings, ...category } = row;
  const labTests: LabListOption[] = labTestMappings.map((m) => ({
    id: m.branchLabTest.id,
    name: m.branchLabTest.testName,
  }));
  const labPanels: LabListOption[] = labPanelMappings.map((m) => ({
    id: m.branchLabPanel.id,
    name: m.branchLabPanel.panelName,
  }));
  return { ...category, labTests, labPanels };
}

/**
 * Patient Category management. Tenant-scoped, tenant-level (name/status/
 * default are shared across the tenant's branches); its Lab Test List / Lab
 * Panel List selections are branch-scoped join rows keyed to the caller's
 * active branch, since they point at branch-level `BranchLabTest`/
 * `BranchLabPanel` rows (CLAUDE.md §4.6/§4.7). Categories are never deleted —
 * only deactivated — to preserve historical order pricing.
 */
@Injectable()
export class PatientCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List active patient categories for a tenant (offset pagination), each with
   * its active branch's mapped Lab Test List / Lab Panel List names. Lazily
   * bootstraps a "General" default category on first call if the tenant has
   * none yet (mirrors PatientSettingsService's upsert-on-read singleton
   * pattern — there is no tenant-provisioning hook to seed this safely).
   * @param tenantId tenant scope
   * @param branchId caller's active branch (resolves mapped list names)
   * @param page 1-based page (default 1)
   * @param limit page size (default 10)
   * @param filters optional case-insensitive `search` (matched against `name`)
   *   and an active/inactive `status` filter
   */
  async findAllForTenant(
    tenantId: string,
    branchId: string,
    page = 1,
    limit = 10,
    filters: { search?: string; status?: 'ACTIVE' | 'INACTIVE' } = {},
  ): Promise<PaginatedResult<PatientCategoryWithLists>> {
    await this.ensureGeneralCategoryExists(tenantId);

    const where: Prisma.PatientCategoryDefinitionWhereInput = {
      tenantId,
      deletedAt: null,
    };
    const search = filters.search?.trim();
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (filters.status) {
      where.isActive = filters.status === 'ACTIVE';
    }

    const data = await this.prisma.patientCategoryDefinition.findMany({
      where,
      include: mappingsInclude(branchId),
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    const total = await this.prisma.patientCategoryDefinition.count({
      where,
    });
    return { data: data.map(toWithLists), total, page, limit };
  }

  /**
   * Fetch one active patient category scoped to its tenant, with the active
   * branch's mapped Lab Test List / Lab Panel List — for the Edit popup.
   * @param id category id
   * @param tenantId tenant scope
   * @param branchId caller's active branch
   * @throws PatientCategoryNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<PatientCategoryWithLists> {
    const category = await this.prisma.patientCategoryDefinition.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: mappingsInclude(branchId),
    });
    if (!category) {
      throw new PatientCategoryNotFoundException(id);
    }
    return toWithLists(category);
  }

  /**
   * Create a patient category in a tenant, mapping its Lab Test List / Lab
   * Panel List to the caller's active branch. If `isDefault` is true, the
   * tenant's previous default (if any) is unset in the same transaction.
   * @param tenantId owning tenant
   * @param branchId caller's active branch (scopes the list validation + mappings)
   * @param dto validated category payload
   * @throws PatientCategoryNameConflictException on a name collision
   * @throws InvalidLabTestSelectionException / InvalidLabPanelSelectionException
   *   if a selected id doesn't belong to an active branch lab test/panel
   * @throws InactiveCategoryCannotBeDefaultException if `isDefault` and
   *   `isActive: false` are both requested together
   */
  async create(
    tenantId: string,
    branchId: string,
    dto: CreatePatientCategoryDto,
  ): Promise<PatientCategoryWithLists> {
    if (dto.isDefault && dto.isActive === false) {
      throw new InactiveCategoryCannotBeDefaultException(dto.name);
    }
    await this.validateLabTestIds(tenantId, branchId, dto.branchLabTestIds);
    await this.validateLabPanelIds(tenantId, branchId, dto.branchLabPanelIds);

    try {
      const id = await this.prisma.withTenant(tenantId, async (tx) => {
        if (dto.isDefault) {
          await this.clearDefault(tx, tenantId);
        }
        const created = await tx.patientCategoryDefinition.create({
          data: {
            tenantId,
            name: dto.name,
            isActive: dto.isActive ?? true,
            isDefault: dto.isDefault ?? false,
            labTestMappings: {
              create: dto.branchLabTestIds.map((branchLabTestId) => ({
                tenantId,
                branchId,
                branchLabTestId,
              })),
            },
            labPanelMappings: {
              create: dto.branchLabPanelIds.map((branchLabPanelId) => ({
                tenantId,
                branchId,
                branchLabPanelId,
              })),
            },
          },
        });
        return created.id;
      });
      return this.findById(id, tenantId, branchId);
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name);
      throw e;
    }
  }

  /**
   * Update a patient category. When `branchLabTestIds`/`branchLabPanelIds` is
   * supplied it REPLACES the whole Lab Test List / Lab Panel List for the
   * caller's active branch (existing mapping rows for that branch are deleted
   * and the new set created — mapping rows carry no independent history). If
   * `isDefault` is set to true, the tenant's previous default is unset first.
   * Enforces the same default/active invariants as `setActive`/`setDefault`
   * (this general endpoint can change both fields at once, so it must not be
   * a back door around either guard).
   * @param id category id
   * @param tenantId tenant scope
   * @param branchId caller's active branch
   * @param dto partial update
   * @throws PatientCategoryNotFoundException if missing/soft-deleted
   * @throws PatientCategoryNameConflictException on a name collision
   * @throws InvalidLabTestSelectionException / InvalidLabPanelSelectionException
   *   if a selected id doesn't belong to an active branch lab test/panel
   * @throws CannotDeactivateDefaultCategoryException if turning off the
   *   tenant's current default category (and not simultaneously handing the
   *   default to another category — that always happens via that other
   *   category's own create/update call)
   * @throws InactiveCategoryCannotBeDefaultException if the category would end
   *   up inactive (already, or via this same call) while being made default
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    dto: UpdatePatientCategoryDto,
  ): Promise<PatientCategoryWithLists> {
    const category = await this.findById(id, tenantId, branchId);
    if (dto.isActive === false && category.isDefault) {
      throw new CannotDeactivateDefaultCategoryException(id);
    }
    const effectiveIsActive = dto.isActive ?? category.isActive;
    if (dto.isDefault && !effectiveIsActive) {
      throw new InactiveCategoryCannotBeDefaultException(id);
    }
    if (dto.branchLabTestIds !== undefined) {
      await this.validateLabTestIds(tenantId, branchId, dto.branchLabTestIds);
    }
    if (dto.branchLabPanelIds !== undefined) {
      await this.validateLabPanelIds(tenantId, branchId, dto.branchLabPanelIds);
    }

    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        if (dto.isDefault) {
          await this.clearDefault(tx, tenantId, id);
        }

        const data: Prisma.PatientCategoryDefinitionUpdateInput = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.isActive !== undefined) data.isActive = dto.isActive;
        if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

        if (dto.branchLabTestIds !== undefined) {
          await tx.patientCategoryLabTest.deleteMany({
            where: { patientCategoryId: id, branchId },
          });
          data.labTestMappings = {
            create: dto.branchLabTestIds.map((branchLabTestId) => ({
              tenantId,
              branchId,
              branchLabTestId,
            })),
          };
        }
        if (dto.branchLabPanelIds !== undefined) {
          await tx.patientCategoryLabPanel.deleteMany({
            where: { patientCategoryId: id, branchId },
          });
          data.labPanelMappings = {
            create: dto.branchLabPanelIds.map((branchLabPanelId) => ({
              tenantId,
              branchId,
              branchLabPanelId,
            })),
          };
        }

        await tx.patientCategoryDefinition.update({ where: { id }, data });
      });
      return this.findById(id, tenantId, branchId);
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name ?? '');
      throw e;
    }
  }

  /**
   * Activate/inactivate a patient category from the settings table row switch.
   * @param id category id
   * @param tenantId tenant scope
   * @param branchId caller's active branch (for the returned mapped lists)
   * @param isActive the new active state
   * @throws PatientCategoryNotFoundException if missing/soft-deleted
   * @throws CannotDeactivateDefaultCategoryException if turning off the
   *   tenant's current default category
   */
  async setActive(
    id: string,
    tenantId: string,
    branchId: string,
    isActive: boolean,
  ): Promise<PatientCategoryWithLists> {
    const category = await this.findById(id, tenantId, branchId);
    if (!isActive && category.isDefault) {
      throw new CannotDeactivateDefaultCategoryException(id);
    }
    await this.prisma.patientCategoryDefinition.update({
      where: { id },
      data: { isActive },
    });
    return this.findById(id, tenantId, branchId);
  }

  /**
   * Set a patient category as the tenant's default, unsetting the previous
   * default (if any) in the same transaction.
   * @param id category id
   * @param tenantId tenant scope
   * @param branchId caller's active branch (for the returned mapped lists)
   * @throws PatientCategoryNotFoundException if missing/soft-deleted
   * @throws InactiveCategoryCannotBeDefaultException if the category is inactive
   */
  async setDefault(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<PatientCategoryWithLists> {
    const category = await this.findById(id, tenantId, branchId);
    if (!category.isActive) {
      throw new InactiveCategoryCannotBeDefaultException(id);
    }
    await this.prisma.withTenant(tenantId, async (tx) => {
      await this.clearDefault(tx, tenantId, id);
      await tx.patientCategoryDefinition.update({
        where: { id },
        data: { isDefault: true },
      });
    });
    return this.findById(id, tenantId, branchId);
  }

  /**
   * Create the tenant's "General" default category if it has none yet.
   * Idempotent under concurrent calls: a unique-constraint race on the
   * (tenant, name) index is swallowed, since another request already won.
   * @param tenantId tenant scope
   */
  private async ensureGeneralCategoryExists(tenantId: string): Promise<void> {
    const existing = await this.prisma.patientCategoryDefinition.findFirst({
      where: { tenantId, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      return;
    }
    try {
      await this.prisma.patientCategoryDefinition.create({
        data: {
          tenantId,
          name: GENERAL_CATEGORY_NAME,
          isActive: true,
          isDefault: true,
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
  }

  /**
   * Unset the tenant's current default category (if any), excluding `exceptId`
   * when supplied (so re-confirming the already-default category is a no-op).
   * @param tx active tenant transaction client
   * @param tenantId tenant scope
   * @param exceptId category id to leave untouched (the one about to become default)
   */
  private async clearDefault(
    tx: Prisma.TransactionClient,
    tenantId: string,
    exceptId?: string,
  ): Promise<void> {
    await tx.patientCategoryDefinition.updateMany({
      where: {
        tenantId,
        isDefault: true,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  /**
   * Verify every id resolves to an active `BranchLabTest` in the tenant's
   * active branch.
   * @throws InvalidLabTestSelectionException listing the offending ids
   */
  private async validateLabTestIds(
    tenantId: string,
    branchId: string,
    ids: string[],
  ): Promise<void> {
    const found = await this.prisma.branchLabTest.findMany({
      where: {
        id: { in: ids },
        tenantId,
        branchId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    const foundIds = new Set(found.map((r) => r.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new InvalidLabTestSelectionException(missing);
    }
  }

  /**
   * Verify every id resolves to an active `BranchLabPanel` in the tenant's
   * active branch.
   * @throws InvalidLabPanelSelectionException listing the offending ids
   */
  private async validateLabPanelIds(
    tenantId: string,
    branchId: string,
    ids: string[],
  ): Promise<void> {
    const found = await this.prisma.branchLabPanel.findMany({
      where: {
        id: { in: ids },
        tenantId,
        branchId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    const foundIds = new Set(found.map((r) => r.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new InvalidLabPanelSelectionException(missing);
    }
  }

  /**
   * If the caught error is a Prisma unique-constraint violation (P2002) on the
   * (tenant, name) index, throw the typed 409. Returns normally otherwise so
   * the caller can rethrow.
   * @param e the caught error
   * @param name the attempted name (for the conflict's context)
   * @throws PatientCategoryNameConflictException
   */
  private rethrowUniqueViolation(e: unknown, name: string): void {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== 'P2002'
    ) {
      return;
    }
    throw new PatientCategoryNameConflictException(name);
  }
}
