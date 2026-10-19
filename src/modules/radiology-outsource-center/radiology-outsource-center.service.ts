import { Injectable } from '@nestjs/common';
import { RadiologyOutsourceCenter, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchRadiologyTestListService } from '../branch-radiology-test-list/branch-radiology-test-list.service';
import { BranchRadiologyPanelListService } from '../branch-radiology-panel-list/branch-radiology-panel-list.service';
import { CreateRadiologyOutsourceCenterDto } from './dto/create-radiology-outsource-center.dto';
import { UpdateRadiologyOutsourceCenterDto } from './dto/update-radiology-outsource-center.dto';
import { ListRadiologyOutsourceCentersDto } from './dto/list-radiology-outsource-centers.dto';
import { RadiologyOutsourceCenterEntity } from './entities/radiology-outsource-center.entity';
import {
  ActiveBranchRequiredException,
  InvalidRadiologyPanelException,
  InvalidRadiologyTestException,
  RadiologyOutsourceCenterNameConflictException,
  RadiologyOutsourceCenterNotFoundException,
} from './exceptions/radiology-outsource-center.exceptions';

/**
 * Radiology outsource-center management. Tenant-scoped, tenant-level (CLAUDE.md
 * §4.6): every query carries `tenantId` (defence in depth on top of RLS, §4.3) and
 * filters soft-deleted rows. Unlike the diagnostics `OutsourceCenter`, this model
 * has NO contacts/documents child tables. The `code` is system-generated
 * (per-tenant sequential, `ROC-00001`…) by atomically incrementing
 * `Tenant.radiologyOutsourceCenterCounter` in the same transaction as the insert,
 * and is immutable thereafter. A center carries a single optional radiology
 * test/panel (`radiologyTestId`/`radiologyPanelId`) and a single optional
 * Radiology Test List / Panel List (`branchRadiologyTestListId`/
 * `branchRadiologyPanelListId`), each a logical ref validated against the tenant
 * (and, for the lists, the caller's active branch).
 */
@Injectable()
export class RadiologyOutsourceCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchRadiologyTestListService: BranchRadiologyTestListService,
    private readonly branchRadiologyPanelListService: BranchRadiologyPanelListService,
  ) {}

  /**
   * Create a radiology outsource center. The `code` is system-generated (per-tenant
   * sequential, `ROC-00001`…) by atomically incrementing
   * `Tenant.radiologyOutsourceCenterCounter`, and is immutable thereafter. The
   * optional `radiologyTestId`/`radiologyPanelId` are validated to be active
   * radiology tests/panels in the tenant.
   * @param tenantId owning tenant
   * @param branchId the caller's active branch (JWT), required only when a
   *   `branchRadiologyTestListId`/`branchRadiologyPanelListId` is being assigned
   * @param dto validated payload (no `code`/`tenantId` — set here / from context)
   * @returns the created center with its resolved test/panel/list names
   * @throws InvalidRadiologyTestException / InvalidRadiologyPanelException if the
   *   selected test/panel is not an active item in the tenant
   * @throws ActiveBranchRequiredException if a list is assigned with no active branch
   * @throws BranchRadiologyTestListNotFoundException /
   *   BranchRadiologyPanelListNotFoundException if the selected list isn't found in
   *   the active branch
   * @throws RadiologyOutsourceCenterNameConflictException if the name is already
   *   used by an active center in this tenant
   */
  async create(
    tenantId: string,
    branchId: string | null,
    dto: CreateRadiologyOutsourceCenterDto,
  ): Promise<RadiologyOutsourceCenterEntity> {
    await this.validateRadiologySelection(
      tenantId,
      dto.radiologyTestId,
      dto.radiologyPanelId,
    );
    await this.validateBranchListSelection(
      tenantId,
      branchId,
      dto.branchRadiologyTestListId,
      dto.branchRadiologyPanelListId,
    );

    try {
      const created = await this.prisma.withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { radiologyOutsourceCenterCounter: { increment: 1 } },
          select: { radiologyOutsourceCenterCounter: true },
        });
        const code = `ROC-${String(tenant.radiologyOutsourceCenterCounter).padStart(5, '0')}`;

        return tx.radiologyOutsourceCenter.create({
          data: { tenantId, code, ...this.toScalarData(dto) },
        });
      });
      const [enriched] = await this.attachNames(tenantId, [created]);
      return enriched!;
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new RadiologyOutsourceCenterNameConflictException(dto.name);
      }
      throw e;
    }
  }

  /**
   * Fetch one active radiology outsource center scoped to its tenant, with the
   * resolved radiology test/panel and list names (left `null` if the referenced row
   * has since been deleted).
   * @param id center id
   * @param tenantId tenant scope
   * @throws RadiologyOutsourceCenterNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<RadiologyOutsourceCenterEntity> {
    const center = await this.prisma.radiologyOutsourceCenter.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!center) {
      throw new RadiologyOutsourceCenterNotFoundException(id);
    }
    const [enriched] = await this.attachNames(tenantId, [center]);
    return enriched!;
  }

  /**
   * List radiology outsource centers for a tenant (offset pagination). Optional
   * case-insensitive `search` (matches the center `name` or `code`) and `status`
   * (active state) filters apply. Each row resolves the assigned radiology
   * test/panel and list names.
   * @param tenantId tenant scope
   * @param query pagination + optional `search`/`status` filters
   */
  async findAll(
    tenantId: string,
    query: ListRadiologyOutsourceCentersDto,
  ): Promise<PaginatedResult<RadiologyOutsourceCenterEntity>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = this.buildListWhere(tenantId, {
      search: query.search,
      status: query.status,
    });
    const [rows, total] = await Promise.all([
      this.prisma.radiologyOutsourceCenter.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.radiologyOutsourceCenter.count({ where }),
    ]);
    const data = await this.attachNames(tenantId, rows);
    return { data, total, page, limit };
  }

  /**
   * Update a radiology outsource center. `code` is immutable.
   * `radiologyTestId`/`radiologyPanelId`, when present, are validated to be active
   * radiology tests/panels in the tenant (pass `null` to clear).
   * @param id center id
   * @param tenantId tenant scope
   * @param branchId the caller's active branch (JWT), required only when a
   *   `branchRadiologyTestListId`/`branchRadiologyPanelListId` is being assigned
   * @param dto partial update
   * @throws RadiologyOutsourceCenterNotFoundException if missing/soft-deleted
   * @throws InvalidRadiologyTestException / InvalidRadiologyPanelException for a bad
   *   selection
   * @throws ActiveBranchRequiredException if a list is assigned with no active branch
   * @throws BranchRadiologyTestListNotFoundException /
   *   BranchRadiologyPanelListNotFoundException if the selected list isn't found in
   *   the active branch
   * @throws RadiologyOutsourceCenterNameConflictException if the new name collides
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string | null,
    dto: UpdateRadiologyOutsourceCenterDto,
  ): Promise<RadiologyOutsourceCenterEntity> {
    await this.findById(id, tenantId);

    await this.validateRadiologySelection(
      tenantId,
      dto.radiologyTestId,
      dto.radiologyPanelId,
    );
    await this.validateBranchListSelection(
      tenantId,
      branchId,
      dto.branchRadiologyTestListId,
      dto.branchRadiologyPanelListId,
    );

    const data = this.toScalarUpdateData(dto);

    try {
      const updated = await this.prisma.withTenant(tenantId, (tx) =>
        tx.radiologyOutsourceCenter.update({ where: { id }, data }),
      );
      const [enriched] = await this.attachNames(tenantId, [updated]);
      return enriched!;
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new RadiologyOutsourceCenterNameConflictException(dto.name ?? '');
      }
      throw e;
    }
  }

  /**
   * Soft-delete a radiology outsource center (sets `deletedAt`; the row is
   * preserved). The model has no child tables to cascade.
   * @param id center id
   * @param tenantId tenant scope
   * @throws RadiologyOutsourceCenterNotFoundException if missing/soft-deleted
   */
  async remove(
    id: string,
    tenantId: string,
  ): Promise<RadiologyOutsourceCenter> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.radiologyOutsourceCenter.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    );
  }

  /**
   * Build the list `where` clause for a tenant: always tenant-scoped and
   * soft-delete filtered, plus an optional case-insensitive `search` over the
   * center `name`/`code` and an `isActive` filter derived from `status`.
   * @param tenantId tenant scope
   * @param filters optional `search` (name/code) and `status` filters
   */
  private buildListWhere(
    tenantId: string,
    filters: { search?: string; status?: 'ACTIVE' | 'INACTIVE' } = {},
  ): Prisma.RadiologyOutsourceCenterWhereInput {
    const where: Prisma.RadiologyOutsourceCenterWhereInput = {
      tenantId,
      deletedAt: null,
    };
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filters.status) {
      where.isActive = filters.status === 'ACTIVE';
    }
    return where;
  }

  /**
   * Resolve each center's single `radiologyTestId`/`radiologyPanelId` to its
   * `testName`/`panelName`, and its `branchRadiologyTestListId`/
   * `branchRadiologyPanelListId` to its list `name` (all batched across the given
   * centers), returning enriched entities. Names are `null` when the id is unset or
   * the referenced row was deleted.
   * @param tenantId tenant scope
   * @param centers the centers to enrich
   */
  private async attachNames(
    tenantId: string,
    centers: RadiologyOutsourceCenter[],
  ): Promise<RadiologyOutsourceCenterEntity[]> {
    const testIds = this.collectIds(centers.map((c) => c.radiologyTestId));
    const panelIds = this.collectIds(centers.map((c) => c.radiologyPanelId));
    const testListIds = this.collectIds(
      centers.map((c) => c.branchRadiologyTestListId),
    );
    const panelListIds = this.collectIds(
      centers.map((c) => c.branchRadiologyPanelListId),
    );

    const [tests, panels, testLists, panelLists] = await Promise.all([
      testIds.length
        ? this.prisma.radiologyTest.findMany({
            where: { tenantId, id: { in: testIds } },
            select: { id: true, testName: true },
          })
        : Promise.resolve([]),
      panelIds.length
        ? this.prisma.radiologyPanel.findMany({
            where: { tenantId, id: { in: panelIds } },
            select: { id: true, panelName: true },
          })
        : Promise.resolve([]),
      testListIds.length
        ? this.prisma.branchRadiologyTestList.findMany({
            where: { tenantId, id: { in: testListIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      panelListIds.length
        ? this.prisma.branchRadiologyPanelList.findMany({
            where: { tenantId, id: { in: panelListIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const testMap = new Map(tests.map((t) => [t.id, t.testName]));
    const panelMap = new Map(panels.map((p) => [p.id, p.panelName]));
    const testListMap = new Map(testLists.map((l) => [l.id, l.name]));
    const panelListMap = new Map(panelLists.map((l) => [l.id, l.name]));

    return centers.map((c) => ({
      ...c,
      radiologyTestName: c.radiologyTestId
        ? (testMap.get(c.radiologyTestId) ?? null)
        : null,
      radiologyPanelName: c.radiologyPanelId
        ? (panelMap.get(c.radiologyPanelId) ?? null)
        : null,
      branchRadiologyTestListName: c.branchRadiologyTestListId
        ? (testListMap.get(c.branchRadiologyTestListId) ?? null)
        : null,
      branchRadiologyPanelListName: c.branchRadiologyPanelListId
        ? (panelListMap.get(c.branchRadiologyPanelListId) ?? null)
        : null,
    }));
  }

  /**
   * Collect the distinct non-null ids from a list of nullable id columns.
   * @param ids the raw id values (some may be null)
   */
  private collectIds(ids: Array<string | null>): string[] {
    return [...new Set(ids.filter((v): v is string => !!v))];
  }

  /**
   * Validate the optional single radiology test / panel selection: each id, when
   * present, must be an active, non-deleted radiology test/panel in the tenant.
   * @param tenantId tenant scope
   * @param radiologyTestId optional selected radiology test id
   * @param radiologyPanelId optional selected radiology panel id
   * @throws InvalidRadiologyTestException / InvalidRadiologyPanelException
   */
  private async validateRadiologySelection(
    tenantId: string,
    radiologyTestId?: string,
    radiologyPanelId?: string,
  ): Promise<void> {
    if (radiologyTestId) {
      const test = await this.prisma.radiologyTest.findFirst({
        where: {
          id: radiologyTestId,
          tenantId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!test) {
        throw new InvalidRadiologyTestException(radiologyTestId);
      }
    }
    if (radiologyPanelId) {
      const panel = await this.prisma.radiologyPanel.findFirst({
        where: {
          id: radiologyPanelId,
          tenantId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!panel) {
        throw new InvalidRadiologyPanelException(radiologyPanelId);
      }
    }
  }

  /**
   * Validate the optional single Radiology Test List / Panel List selection: each
   * id, when present, must be a non-deleted `BranchRadiologyTestList`/
   * `BranchRadiologyPanelList` in the tenant's active branch. Requires an active
   * branch only when a list is actually being assigned.
   * @param tenantId tenant scope
   * @param branchId the caller's active branch (JWT), or `null` if none
   * @param branchRadiologyTestListId optional selected Radiology Test List id
   * @param branchRadiologyPanelListId optional selected Radiology Panel List id
   * @throws ActiveBranchRequiredException if a list id is given with no active branch
   * @throws BranchRadiologyTestListNotFoundException /
   *   BranchRadiologyPanelListNotFoundException
   */
  private async validateBranchListSelection(
    tenantId: string,
    branchId: string | null,
    branchRadiologyTestListId?: string,
    branchRadiologyPanelListId?: string,
  ): Promise<void> {
    if (!branchRadiologyTestListId && !branchRadiologyPanelListId) {
      return;
    }
    if (!branchId) {
      throw new ActiveBranchRequiredException();
    }
    if (branchRadiologyTestListId) {
      await this.branchRadiologyTestListService.findById(
        branchRadiologyTestListId,
        tenantId,
        branchId,
      );
    }
    if (branchRadiologyPanelListId) {
      await this.branchRadiologyPanelListService.findById(
        branchRadiologyPanelListId,
        tenantId,
        branchId,
      );
    }
  }

  /**
   * Build the scalar create payload (basic + legal/financial + radiology selection
   * + flags) from a create DTO, normalising optional fields to `null`.
   * @param dto the create DTO
   */
  private toScalarData(
    dto: CreateRadiologyOutsourceCenterDto,
  ): Omit<Prisma.RadiologyOutsourceCenterCreateInput, 'tenantId' | 'code'> {
    return {
      name: dto.name,
      shortName: dto.shortName ?? null,
      address: dto.address ?? null,
      country: dto.country ?? null,
      city: dto.city ?? '',
      state: dto.state ?? null,
      pincode: dto.pincode ?? null,
      gstNumber: dto.gstNumber ?? null,
      panNumber: dto.panNumber ?? null,
      accountHolderName: dto.accountHolderName ?? null,
      bankName: dto.bankName ?? null,
      bankAccountNumber: dto.bankAccountNumber ?? null,
      ifscCode: dto.ifscCode ?? null,
      isActive: dto.isActive ?? true,
      isNablAccredited: dto.isNablAccredited ?? false,
      radiologyTestId: dto.radiologyTestId ?? null,
      radiologyPanelId: dto.radiologyPanelId ?? null,
      branchRadiologyTestListId: dto.branchRadiologyTestListId ?? null,
      branchRadiologyPanelListId: dto.branchRadiologyPanelListId ?? null,
    };
  }

  /**
   * Build the scalar update payload from an update DTO. Only fields present on the
   * DTO are written (`code` is immutable).
   * @param dto the update DTO
   */
  private toScalarUpdateData(
    dto: UpdateRadiologyOutsourceCenterDto,
  ): Prisma.RadiologyOutsourceCenterUpdateInput {
    const data: Prisma.RadiologyOutsourceCenterUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.shortName !== undefined) data.shortName = dto.shortName ?? null;
    if (dto.address !== undefined) data.address = dto.address ?? null;
    if (dto.country !== undefined) data.country = dto.country ?? null;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.state !== undefined) data.state = dto.state ?? null;
    if (dto.pincode !== undefined) data.pincode = dto.pincode ?? null;
    if (dto.gstNumber !== undefined) data.gstNumber = dto.gstNumber ?? null;
    if (dto.panNumber !== undefined) data.panNumber = dto.panNumber ?? null;
    if (dto.accountHolderName !== undefined)
      data.accountHolderName = dto.accountHolderName ?? null;
    if (dto.bankName !== undefined) data.bankName = dto.bankName ?? null;
    if (dto.bankAccountNumber !== undefined)
      data.bankAccountNumber = dto.bankAccountNumber ?? null;
    if (dto.ifscCode !== undefined) data.ifscCode = dto.ifscCode ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isNablAccredited !== undefined)
      data.isNablAccredited = dto.isNablAccredited;
    if (dto.radiologyTestId !== undefined)
      data.radiologyTestId = dto.radiologyTestId ?? null;
    if (dto.radiologyPanelId !== undefined)
      data.radiologyPanelId = dto.radiologyPanelId ?? null;
    if (dto.branchRadiologyTestListId !== undefined)
      data.branchRadiologyTestListId = dto.branchRadiologyTestListId ?? null;
    if (dto.branchRadiologyPanelListId !== undefined)
      data.branchRadiologyPanelListId = dto.branchRadiologyPanelListId ?? null;
    return data;
  }

  /**
   * Narrow an unknown caught error to a Prisma unique-constraint violation (P2002).
   * Used to map the per-tenant center-name index to a typed 409.
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
