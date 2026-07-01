import { Injectable } from '@nestjs/common';
import { OutsourceCenter, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateOutsourceCenterDto } from './dto/create-outsource-center.dto';
import { UpdateOutsourceCenterDto } from './dto/update-outsource-center.dto';
import { OutsourceCenterContactDto } from './dto/outsource-center-contact.dto';
import { ListOutsourceCentersDto } from './dto/list-outsource-centers.dto';
import {
  OutsourceCenterEntity,
  OutsourceCenterListView,
} from './entities/outsource-center.entity';
import {
  DuplicateContactRoleException,
  InvalidLabPanelException,
  InvalidLabTestException,
  OutsourceCenterNameConflictException,
  OutsourceCenterNotFoundException,
} from './exceptions/outsource-center.exceptions';

/**
 * Outsource-center management. Tenant-scoped, tenant-level (CLAUDE.md §4.6): every
 * query carries `tenantId` (defence in depth on top of RLS, §4.3) and filters
 * soft-deleted rows. Contacts are child rows owned by the center and managed
 * together with it (replace-all on update). A center carries a single optional lab
 * test and lab panel (`labTestId` / `labPanelId`), each a logical ref validated to
 * be an active lab test/panel in the tenant.
 */
@Injectable()
export class OutsourceCenterService {
  /** Nested include used everywhere a full center is returned. */
  private static readonly FULL_INCLUDE = {
    contacts: { where: { deletedAt: null } },
  } satisfies Prisma.OutsourceCenterInclude;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an outsource center with its contacts in one transaction. The `code` is
   * system-generated (per-tenant sequential, `OC-00001`…) by atomically
   * incrementing `Tenant.outsourceCenterCounter`, and is immutable thereafter. The
   * optional `labTestId` / `labPanelId` are validated to be active lab tests/panels
   * in the tenant.
   * @param tenantId owning tenant
   * @param dto validated payload (no `code`/`tenantId` — set here / from context)
   * @returns the created center with its active contacts and resolved test/panel names
   * @throws DuplicateContactRoleException if a contact role appears twice
   * @throws InvalidLabTestException / InvalidLabPanelException if the selected
   *   test/panel is not an active item in the tenant
   * @throws OutsourceCenterNameConflictException if the name is already used by an
   *   active center in this tenant
   */
  async create(
    tenantId: string,
    dto: CreateOutsourceCenterDto,
  ): Promise<OutsourceCenterEntity> {
    await this.validateLabSelection(tenantId, dto.labTestId, dto.labPanelId);
    const contacts = this.cleanContacts(dto.contacts);

    try {
      const created = await this.prisma.withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { outsourceCenterCounter: { increment: 1 } },
          select: { outsourceCenterCounter: true },
        });
        const code = `OC-${String(tenant.outsourceCenterCounter).padStart(5, '0')}`;

        const center = await tx.outsourceCenter.create({
          data: { tenantId, code, ...this.toScalarData(dto) },
        });

        if (contacts.length) {
          await tx.outsourceCenterContact.createMany({
            data: contacts.map((c) => ({
              tenantId,
              outsourceCenterId: center.id,
              role: c.role,
              name: c.name ?? null,
              mobile: c.mobile ?? null,
              email: c.email ?? null,
            })),
          });
        }

        return tx.outsourceCenter.findFirstOrThrow({
          where: { id: center.id },
          include: OutsourceCenterService.FULL_INCLUDE,
        });
      });
      return this.attachNames(tenantId, [created]).then((r) => r[0]!);
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new OutsourceCenterNameConflictException(dto.name);
      }
      throw e;
    }
  }

  /**
   * Fetch one active outsource center scoped to its tenant, with its active
   * contacts and the resolved lab test/panel names (left `null` if the referenced
   * test/panel has since been deleted).
   * @param id center id
   * @param tenantId tenant scope
   * @throws OutsourceCenterNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<OutsourceCenterEntity> {
    const center = await this.prisma.outsourceCenter.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: OutsourceCenterService.FULL_INCLUDE,
    });
    if (!center) {
      throw new OutsourceCenterNotFoundException(id);
    }
    const [enriched] = await this.attachNames(tenantId, [center]);
    return enriched!;
  }

  /**
   * Entry point for the list endpoint (`GET /outsource-centers`). Dispatches on
   * the requested view: `DEFAULT` (or omitted) lists the centers; `CONTACTS` lists
   * the centers with each center's active contacts embedded. Optional
   * case-insensitive `search` (matches the center `name` or `code`) and `status`
   * (active state) filters apply to both views. Both views resolve the assigned lab
   * test/panel names.
   * @param tenantId tenant scope
   * @param query pagination + `view` + optional `search`/`status` filters
   */
  async findAll(
    tenantId: string,
    query: ListOutsourceCentersDto,
  ): Promise<PaginatedResult<OutsourceCenterEntity>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filters = { search: query.search, status: query.status };
    const includeContacts =
      (query.view ?? OutsourceCenterListView.DEFAULT) ===
      OutsourceCenterListView.CONTACTS;

    const where = this.buildListWhere(tenantId, filters);
    const [rows, total] = await Promise.all([
      this.prisma.outsourceCenter.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        ...(includeContacts
          ? { include: { contacts: { where: { deletedAt: null } } } }
          : {}),
      }),
      this.prisma.outsourceCenter.count({ where }),
    ]);
    const data = await this.attachNames(tenantId, rows);
    return { data, total, page, limit };
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
  ): Prisma.OutsourceCenterWhereInput {
    const where: Prisma.OutsourceCenterWhereInput = {
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
   * Update an outsource center. `code` is immutable. `contacts` are replace-all
   * when present (soft-delete the active set, then recreate) and left untouched
   * when absent. `labTestId` / `labPanelId`, when present, are validated to be
   * active lab tests/panels in the tenant (pass `null` to clear).
   * @param id center id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws OutsourceCenterNotFoundException if missing/soft-deleted
   * @throws InvalidLabTestException / InvalidLabPanelException for a bad selection
   * @throws OutsourceCenterNameConflictException if the new name collides
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateOutsourceCenterDto,
  ): Promise<OutsourceCenterEntity> {
    await this.findById(id, tenantId);

    await this.validateLabSelection(tenantId, dto.labTestId, dto.labPanelId);
    const contacts =
      dto.contacts !== undefined ? this.cleanContacts(dto.contacts) : undefined;

    const data = this.toScalarUpdateData(dto);
    const now = new Date();

    try {
      const updated = await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.outsourceCenter.update({ where: { id }, data });

        if (contacts !== undefined) {
          await tx.outsourceCenterContact.updateMany({
            where: { outsourceCenterId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          if (contacts.length) {
            await tx.outsourceCenterContact.createMany({
              data: contacts.map((c) => ({
                tenantId,
                outsourceCenterId: id,
                role: c.role,
                name: c.name ?? null,
                mobile: c.mobile ?? null,
                email: c.email ?? null,
              })),
            });
          }
        }

        return tx.outsourceCenter.findFirstOrThrow({
          where: { id },
          include: OutsourceCenterService.FULL_INCLUDE,
        });
      });
      return this.attachNames(tenantId, [updated]).then((r) => r[0]!);
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new OutsourceCenterNameConflictException(dto.name ?? '');
      }
      throw e;
    }
  }

  /**
   * Soft-delete an outsource center and cascade soft-delete its active contacts in
   * one transaction.
   * @param id center id
   * @param tenantId tenant scope
   * @throws OutsourceCenterNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<OutsourceCenter> {
    await this.findById(id, tenantId);
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.outsourceCenterContact.updateMany({
        where: { outsourceCenterId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.outsourceCenter.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Resolve each center's single `labTestId` / `labPanelId` to its `testName` /
   * `panelName` (batched across the given centers), returning enriched entities.
   * Names are `null` when the id is unset or the referenced test/panel was deleted.
   * @param tenantId tenant scope
   * @param centers the centers to enrich (any include shape)
   */
  private async attachNames<T extends OutsourceCenter>(
    tenantId: string,
    centers: T[],
  ): Promise<
    Array<T & { labTestName: string | null; labPanelName: string | null }>
  > {
    const testIds = [
      ...new Set(
        centers.map((c) => c.labTestId).filter((v): v is string => !!v),
      ),
    ];
    const panelIds = [
      ...new Set(
        centers.map((c) => c.labPanelId).filter((v): v is string => !!v),
      ),
    ];

    const [tests, panels] = await Promise.all([
      testIds.length
        ? this.prisma.labTest.findMany({
            where: { tenantId, id: { in: testIds } },
            select: { id: true, testName: true },
          })
        : Promise.resolve([]),
      panelIds.length
        ? this.prisma.labPanel.findMany({
            where: { tenantId, id: { in: panelIds } },
            select: { id: true, panelName: true },
          })
        : Promise.resolve([]),
    ]);
    const testMap = new Map(tests.map((t) => [t.id, t.testName]));
    const panelMap = new Map(panels.map((p) => [p.id, p.panelName]));

    return centers.map((c) => ({
      ...c,
      labTestName: c.labTestId ? (testMap.get(c.labTestId) ?? null) : null,
      labPanelName: c.labPanelId ? (panelMap.get(c.labPanelId) ?? null) : null,
    }));
  }

  /**
   * Validate the optional single lab test / lab panel selection: each id, when
   * present, must be an active, non-deleted lab test/panel in the tenant.
   * @param tenantId tenant scope
   * @param labTestId optional selected lab test id
   * @param labPanelId optional selected lab panel id
   * @throws InvalidLabTestException / InvalidLabPanelException
   */
  private async validateLabSelection(
    tenantId: string,
    labTestId?: string,
    labPanelId?: string,
  ): Promise<void> {
    if (labTestId) {
      const test = await this.prisma.labTest.findFirst({
        where: { id: labTestId, tenantId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!test) {
        throw new InvalidLabTestException(labTestId);
      }
    }
    if (labPanelId) {
      const panel = await this.prisma.labPanel.findFirst({
        where: { id: labPanelId, tenantId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!panel) {
        throw new InvalidLabPanelException(labPanelId);
      }
    }
  }

  /**
   * Filter out contact entries with no name, mobile, or email, and reject duplicate
   * roles (the DB allows one active contact per role per center).
   * @param contacts raw contact DTOs (may be undefined)
   * @returns the contacts worth persisting
   * @throws DuplicateContactRoleException if a role appears more than once
   */
  private cleanContacts(
    contacts?: OutsourceCenterContactDto[],
  ): OutsourceCenterContactDto[] {
    if (!contacts) {
      return [];
    }
    const kept = contacts.filter(
      (c) => c.name?.trim() || c.mobile?.trim() || c.email?.trim(),
    );
    const seen = new Set<string>();
    for (const c of kept) {
      if (seen.has(c.role)) {
        throw new DuplicateContactRoleException(c.role);
      }
      seen.add(c.role);
    }
    return kept;
  }

  /**
   * Build the scalar create payload (basic + legal/financial + lab selection +
   * flags) from a create DTO, normalising optional fields to `null`.
   * @param dto the create DTO
   */
  private toScalarData(
    dto: CreateOutsourceCenterDto,
  ): Omit<Prisma.OutsourceCenterCreateInput, 'tenantId' | 'code'> {
    return {
      name: dto.name,
      shortName: dto.shortName ?? null,
      address: dto.address ?? null,
      city: dto.city,
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
      labTestId: dto.labTestId ?? null,
      labPanelId: dto.labPanelId ?? null,
    };
  }

  /**
   * Build the scalar update payload from an update DTO. Only fields present on the
   * DTO are written (`code` is immutable; `contacts` handled separately).
   * @param dto the update DTO
   */
  private toScalarUpdateData(
    dto: UpdateOutsourceCenterDto,
  ): Prisma.OutsourceCenterUpdateInput {
    const data: Prisma.OutsourceCenterUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.shortName !== undefined) data.shortName = dto.shortName ?? null;
    if (dto.address !== undefined) data.address = dto.address ?? null;
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
    if (dto.labTestId !== undefined) data.labTestId = dto.labTestId ?? null;
    if (dto.labPanelId !== undefined) data.labPanelId = dto.labPanelId ?? null;
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
