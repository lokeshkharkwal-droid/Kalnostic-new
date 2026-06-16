import { Injectable } from '@nestjs/common';
import {
  Branch,
  OutsourceCenter,
  OutsourceCenterBranchAssignment,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { CreateOutsourceCenterDto } from './dto/create-outsource-center.dto';
import { UpdateOutsourceCenterDto } from './dto/update-outsource-center.dto';
import { OutsourceCenterContactDto } from './dto/outsource-center-contact.dto';
import { OutsourceCenterBranchAssignmentDto } from './dto/outsource-center-branch-assignment.dto';
import { ListOutsourceCentersDto } from './dto/list-outsource-centers.dto';
import {
  OutsourceCenterEntity,
  OutsourceCenterListView,
} from './entities/outsource-center.entity';
import {
  DuplicateBranchAssignmentException,
  DuplicateContactRoleException,
  InvalidPanelForBranchException,
  InvalidTestForBranchException,
  MissingSelectionException,
  OutsourceCenterNameConflictException,
  OutsourceCenterNoBranchException,
  OutsourceCenterNotFoundException,
} from './exceptions/outsource-center.exceptions';

/** A selectable active lab test for a branch (returned by the lookup endpoint). */
export interface BranchLabTestItem {
  id: string;
  testName: string;
  testCode: string;
  masterDataId: string;
}

/** A selectable active lab panel for a branch (returned by the lookup endpoint). */
export interface BranchLabPanelItem {
  id: string;
  panelName: string;
  panelCode: string;
  masterDataId: string;
}

/** The active lab tests and lab panels available to assign for one branch. */
export interface BranchLabItems {
  branchId: string;
  branchName: string;
  branchCode: string;
  labTests: BranchLabTestItem[];
  labPanels: BranchLabPanelItem[];
}

/**
 * Outsource-center management. Tenant-scoped, tenant-level (CLAUDE.md §4.6): every
 * query carries `tenantId` (defence in depth on top of RLS, §4.3) and filters
 * soft-deleted rows. Contacts and branch assignments are child rows owned by the
 * center and managed together with it (replace-all on update). A center is assigned
 * to branches via `OutsourceCenterBranchAssignment`; each assignment carries the
 * specific lab tests and lab panels the outsource party may handle for that branch
 * (`OutsourceCenterBranchTest` / `OutsourceCenterBranchPanel`).
 */
@Injectable()
export class OutsourceCenterService {
  /** Nested include used everywhere a full center is returned. */
  private static readonly FULL_INCLUDE = {
    contacts: { where: { deletedAt: null } },
    assignments: {
      where: { deletedAt: null },
      include: {
        tests: { where: { deletedAt: null } },
        panels: { where: { deletedAt: null } },
      },
    },
  } satisfies Prisma.OutsourceCenterInclude;

  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Create an outsource center with its contacts and branch assignments (each with
   * its selected lab tests and lab panels) in one transaction. The `code` is
   * system-generated (per-tenant sequential, `OC-00001`…) by atomically
   * incrementing `Tenant.outsourceCenterCounter`, and is immutable thereafter. At
   * least one branch assignment is required, and each assignment must select at
   * least one lab test or lab panel.
   * @param tenantId owning tenant
   * @param dto validated payload (no `code`/`tenantId` — set here / from context)
   * @returns the created center with its active contacts and assignments
   * @throws OutsourceCenterNoBranchException if no branch is assigned
   * @throws DuplicateBranchAssignmentException if a branch is assigned twice
   * @throws DuplicateContactRoleException if a contact role appears twice
   * @throws MissingSelectionException if an assigned branch selects no test/panel
   * @throws InvalidTestForBranchException / InvalidPanelForBranchException if a
   *   selected test/panel is not an active item on its branch
   * @throws OutsourceCenterNameConflictException if the name is already used by an
   *   active center in this tenant
   */
  async create(
    tenantId: string,
    dto: CreateOutsourceCenterDto,
  ): Promise<OutsourceCenterEntity> {
    await this.validateAssignments(tenantId, dto.assignments);
    const contacts = this.cleanContacts(dto.contacts);

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
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

        for (const a of dto.assignments) {
          const assignment = await tx.outsourceCenterBranchAssignment.create({
            data: {
              tenantId,
              branchId: a.branchId,
              outsourceCenterId: center.id,
            },
          });
          await this.writeAssignmentItems(
            tx,
            tenantId,
            center.id,
            assignment,
            a,
          );
        }

        return tx.outsourceCenter.findFirstOrThrow({
          where: { id: center.id },
          include: OutsourceCenterService.FULL_INCLUDE,
        });
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new OutsourceCenterNameConflictException(dto.name);
      }
      throw e;
    }
  }

  /**
   * Fetch one active outsource center scoped to its tenant, with its active
   * contacts and branch assignments. Each assignment's selected tests/panels are
   * enriched inline with the lab test/panel name and code (resolved by id; left
   * `null` if the referenced test/panel has since been deleted).
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

    const assignments = center.assignments ?? [];
    const testIds = [
      ...new Set(assignments.flatMap((a) => a.tests.map((t) => t.labTestId))),
    ];
    const panelIds = [
      ...new Set(assignments.flatMap((a) => a.panels.map((p) => p.labPanelId))),
    ];

    const [tests, panels] = await Promise.all([
      testIds.length
        ? this.prisma.labTest.findMany({
            where: { tenantId, id: { in: testIds } },
            select: { id: true, testName: true, testCode: true },
          })
        : Promise.resolve([]),
      panelIds.length
        ? this.prisma.labPanel.findMany({
            where: { tenantId, id: { in: panelIds } },
            select: { id: true, panelName: true, panelCode: true },
          })
        : Promise.resolve([]),
    ]);
    const testMap = new Map(tests.map((t) => [t.id, t]));
    const panelMap = new Map(panels.map((p) => [p.id, p]));

    return {
      ...center,
      assignments: assignments.map((a) => ({
        ...a,
        tests: a.tests.map((t) => ({
          ...t,
          testName: testMap.get(t.labTestId)?.testName ?? null,
          testCode: testMap.get(t.labTestId)?.testCode ?? null,
        })),
        panels: a.panels.map((p) => ({
          ...p,
          panelName: panelMap.get(p.labPanelId)?.panelName ?? null,
          panelCode: panelMap.get(p.labPanelId)?.panelCode ?? null,
        })),
      })),
    };
  }

  /**
   * Entry point for the list endpoint (`GET /outsource-centers`). Dispatches on
   * the requested view: `DEFAULT` (or omitted) lists the centers (scalar only);
   * `CONTACTS` lists the centers with each center's active contacts embedded.
   * @param tenantId tenant scope
   * @param query pagination + `view`
   */
  async findAll(
    tenantId: string,
    query: ListOutsourceCentersDto,
  ): Promise<PaginatedResult<OutsourceCenterEntity>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    if (
      (query.view ?? OutsourceCenterListView.DEFAULT) ===
      OutsourceCenterListView.CONTACTS
    ) {
      return this.findAllWithContacts(tenantId, page, limit);
    }
    return this.findAllForTenant(tenantId, page, limit);
  }

  /**
   * List active outsource centers for a tenant with each center's active
   * contacts embedded (offset pagination). Tenant-scoped and soft-delete
   * filtered; the embedded contacts are filtered to active rows too.
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   */
  async findAllWithContacts(
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<OutsourceCenterEntity>> {
    const where = { tenantId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.outsourceCenter.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { contacts: { where: { deletedAt: null } } },
      }),
      this.prisma.outsourceCenter.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * List active outsource centers for a tenant (offset pagination).
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<OutsourceCenter>> {
    const where = { tenantId, deletedAt: null };
    const data = await this.prisma.outsourceCenter.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.outsourceCenter.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update an outsource center. `code` is immutable. `contacts` and `assignments`
   * are replace-all when present (soft-delete the active set, then recreate) and
   * left untouched when absent — so unchecking a branch means omitting it from the
   * new `assignments` array. Replacing assignments also replaces their selected
   * tests/panels. The assignments array, when present, must still be non-empty.
   * @param id center id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws OutsourceCenterNotFoundException if missing/soft-deleted
   * @throws OutsourceCenterNoBranchException if `assignments` is present but empty
   * @throws OutsourceCenterNameConflictException if the new name collides
   *   (plus the assignment/contact validation errors from `create`)
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateOutsourceCenterDto,
  ): Promise<OutsourceCenterEntity> {
    await this.findById(id, tenantId);

    if (dto.assignments !== undefined) {
      await this.validateAssignments(tenantId, dto.assignments);
    }
    const contacts =
      dto.contacts !== undefined ? this.cleanContacts(dto.contacts) : undefined;

    const data = this.toScalarUpdateData(dto);
    const now = new Date();

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
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

        if (dto.assignments !== undefined) {
          // Replace-all: soft-delete the selected items first, then the
          // assignments that own them, then recreate from the new payload.
          await tx.outsourceCenterBranchTest.updateMany({
            where: { outsourceCenterId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await tx.outsourceCenterBranchPanel.updateMany({
            where: { outsourceCenterId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await tx.outsourceCenterBranchAssignment.updateMany({
            where: { outsourceCenterId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          for (const a of dto.assignments) {
            const assignment = await tx.outsourceCenterBranchAssignment.create({
              data: { tenantId, branchId: a.branchId, outsourceCenterId: id },
            });
            await this.writeAssignmentItems(tx, tenantId, id, assignment, a);
          }
        }

        return tx.outsourceCenter.findFirstOrThrow({
          where: { id },
          include: OutsourceCenterService.FULL_INCLUDE,
        });
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new OutsourceCenterNameConflictException(dto.name ?? '');
      }
      throw e;
    }
  }

  /**
   * Soft-delete an outsource center and cascade soft-delete its active contacts,
   * branch assignments, and the assignments' selected tests/panels in one
   * transaction.
   * @param id center id
   * @param tenantId tenant scope
   * @throws OutsourceCenterNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<OutsourceCenter> {
    await this.findById(id, tenantId);
    const now = new Date();
    const scope = { outsourceCenterId: id, tenantId, deletedAt: null };
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.outsourceCenterBranchTest.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
      await tx.outsourceCenterBranchPanel.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
      await tx.outsourceCenterBranchAssignment.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
      await tx.outsourceCenterContact.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
      return tx.outsourceCenter.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * List the branches that may be assigned to an outsource center: those with at
   * least one active lab test OR active lab panel. Ordered main branch first, then
   * by `createdAt` ascending.
   * @param tenantId tenant scope
   * @returns the eligible branches in display order
   */
  async findEligibleBranches(tenantId: string): Promise<Branch[]> {
    const [testBranches, panelBranches] = await Promise.all([
      this.prisma.labTest.groupBy({
        by: ['branchId'],
        where: { tenantId, isActive: true, deletedAt: null },
      }),
      this.prisma.labPanel.groupBy({
        by: ['branchId'],
        where: { tenantId, isActive: true, deletedAt: null },
      }),
    ]);
    const eligibleIds = [
      ...new Set([
        ...testBranches.map((g) => g.branchId),
        ...panelBranches.map((g) => g.branchId),
      ]),
    ];
    if (eligibleIds.length === 0) {
      return [];
    }

    const branches = await this.prisma.branch.findMany({
      where: { tenantId, deletedAt: null, id: { in: eligibleIds } },
    });
    const pointer = await this.prisma.tenantMainBranch.findUnique({
      where: { tenantId },
    });
    const mainId = pointer?.branchId;
    return branches.sort((a, b) => {
      if (a.id === mainId) return -1;
      if (b.id === mainId) return 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  /**
   * For each requested branch, the active lab tests and lab panels available to
   * assign to an outsource center. Drives the selection UI: the frontend passes the
   * branches the center will serve and gets back the items to pick from. Every
   * branch id is validated to belong to the caller's tenant. Result order follows
   * the input order (deduplicated).
   * @param tenantId tenant scope
   * @param branchIds the branches to fetch items for
   * @throws BranchNotFoundException if any branch is missing/other tenant
   */
  async findBranchLabItems(
    tenantId: string,
    branchIds: string[],
  ): Promise<BranchLabItems[]> {
    const uniqueIds = [...new Set(branchIds)];
    const branches: Branch[] = [];
    for (const branchId of uniqueIds) {
      branches.push(await this.branchService.findById(branchId, tenantId));
    }

    const [tests, panels] = await Promise.all([
      this.prisma.labTest.findMany({
        where: {
          tenantId,
          branchId: { in: uniqueIds },
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          testName: true,
          testCode: true,
          masterDataId: true,
          branchId: true,
        },
      }),
      this.prisma.labPanel.findMany({
        where: {
          tenantId,
          branchId: { in: uniqueIds },
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          panelName: true,
          panelCode: true,
          masterDataId: true,
          branchId: true,
        },
      }),
    ]);

    return branches.map((b) => ({
      branchId: b.id,
      branchName: b.name,
      branchCode: b.code,
      labTests: tests
        .filter((t) => t.branchId === b.id)
        .map(({ id, testName, testCode, masterDataId }) => ({
          id,
          testName,
          testCode,
          masterDataId,
        })),
      labPanels: panels
        .filter((p) => p.branchId === b.id)
        .map(({ id, panelName, panelCode, masterDataId }) => ({
          id,
          panelName,
          panelCode,
          masterDataId,
        })),
    }));
  }

  /**
   * Validate a set of branch assignments before persisting: non-empty, no duplicate
   * branches, every branch belongs to the tenant, every branch selects at least one
   * test or panel, and every selected test/panel is an active item on that branch.
   * @param tenantId tenant scope
   * @param assignments the assignments to validate
   * @throws OutsourceCenterNoBranchException / DuplicateBranchAssignmentException /
   *   MissingSelectionException / InvalidTestForBranchException /
   *   InvalidPanelForBranchException / BranchNotFoundException
   */
  private async validateAssignments(
    tenantId: string,
    assignments: OutsourceCenterBranchAssignmentDto[],
  ): Promise<void> {
    if (assignments.length === 0) {
      throw new OutsourceCenterNoBranchException();
    }
    const seen = new Set<string>();
    for (const a of assignments) {
      if (seen.has(a.branchId)) {
        throw new DuplicateBranchAssignmentException(a.branchId);
      }
      seen.add(a.branchId);

      // Client-supplied branch id — validate it belongs to this tenant (§4.7).
      await this.branchService.findById(a.branchId, tenantId);

      const testIds = a.labTestIds ?? [];
      const panelIds = a.labPanelIds ?? [];
      if (testIds.length === 0 && panelIds.length === 0) {
        throw new MissingSelectionException(a.branchId);
      }

      if (testIds.length) {
        const found = await this.prisma.labTest.findMany({
          where: {
            id: { in: testIds },
            tenantId,
            branchId: a.branchId,
            isActive: true,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (found.length !== testIds.length) {
          const ok = new Set(found.map((t) => t.id));
          throw new InvalidTestForBranchException(
            a.branchId,
            testIds.filter((id) => !ok.has(id)),
          );
        }
      }

      if (panelIds.length) {
        const found = await this.prisma.labPanel.findMany({
          where: {
            id: { in: panelIds },
            tenantId,
            branchId: a.branchId,
            isActive: true,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (found.length !== panelIds.length) {
          const ok = new Set(found.map((p) => p.id));
          throw new InvalidPanelForBranchException(
            a.branchId,
            panelIds.filter((id) => !ok.has(id)),
          );
        }
      }
    }
  }

  /**
   * Persist an assignment's selected lab tests and lab panels. Assumes the ids were
   * already validated by `validateAssignments`.
   * @param tx active transaction client
   * @param tenantId tenant scope
   * @param outsourceCenterId owning center
   * @param assignment the assignment the items belong to
   * @param dto the assignment payload (its `labTestIds` / `labPanelIds`)
   */
  private async writeAssignmentItems(
    tx: Prisma.TransactionClient,
    tenantId: string,
    outsourceCenterId: string,
    assignment: OutsourceCenterBranchAssignment,
    dto: OutsourceCenterBranchAssignmentDto,
  ): Promise<void> {
    const testIds = dto.labTestIds ?? [];
    const panelIds = dto.labPanelIds ?? [];
    if (testIds.length) {
      await tx.outsourceCenterBranchTest.createMany({
        data: testIds.map((labTestId) => ({
          tenantId,
          branchId: assignment.branchId,
          outsourceCenterId,
          assignmentId: assignment.id,
          labTestId,
        })),
      });
    }
    if (panelIds.length) {
      await tx.outsourceCenterBranchPanel.createMany({
        data: panelIds.map((labPanelId) => ({
          tenantId,
          branchId: assignment.branchId,
          outsourceCenterId,
          assignmentId: assignment.id,
          labPanelId,
        })),
      });
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
   * Build the scalar create payload (basic + legal/financial fields) from a create
   * DTO, normalising optional fields to `null`.
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
    };
  }

  /**
   * Build the scalar update payload from an update DTO. Only fields present on the
   * DTO are written (`code` is immutable; `contacts`/`assignments` handled
   * separately).
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
