import { Injectable } from '@nestjs/common';
import {
  BranchType,
  DataSource,
  DoctorType,
  PersonMappingType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { CreateDepartmentTemplateDto } from './dto/create-department-template.dto';
import { UpdateDepartmentTemplateDto } from './dto/update-department-template.dto';
import { DepartmentPersonMappingDto } from './dto/department-person-mapping.dto';
import {
  DepartmentEntity,
  DepartmentWithMappings,
} from './entities/department.entity';
import {
  DepartmentNameConflictException,
  DepartmentNotFoundException,
  DepartmentShortNameConflictException,
  DuplicateDefaultPositionException,
  InvalidDepartmentPriorityException,
  InvalidPersonMappingReferenceException,
  PersonNotFoundException,
} from './exceptions/department.exceptions';

/** The single SiteAdminCounter row id (schema `@default("global")`). */
const SITE_ADMIN_COUNTER_ID = 'global';

/** Eager-load active person mappings, ordered by priority. */
const MAPPINGS_INCLUDE = {
  personMappings: {
    where: { deletedAt: null },
    orderBy: { priority: 'asc' },
  },
} satisfies Prisma.DepartmentInclude;

/**
 * Department management. Tenant-scoped, tenant-level (no branch — CLAUDE.md
 * §4.6). Every query carries `tenantId` (defence in depth on top of RLS,
 * §4.3) and filters soft-deleted rows.
 */
@Injectable()
export class DepartmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Create a department in a tenant. The `code` is system-generated and
   * immutable: `{INITIALS}-Dep-{n}`, where INITIALS are derived from the tenant
   * name and `n` is a 0-based per-tenant sequence taken by atomically
   * incrementing `Tenant.departmentCounter` in the same transaction (so
   * concurrent creates never collide). Person mappings (if any) are validated
   * before insert.
   * @param tenantId owning tenant
   * @param dto validated department payload (no `code` — generated here)
   * @returns the created department with its active person mappings
   * @throws DepartmentNameConflictException if the name is already used by an
   *   active department in this tenant
   * @throws DepartmentShortNameConflictException if the shortName is already
   *   used by an active department in this tenant
   * @throws InvalidDepartmentPriorityException / DuplicateDefaultPositionException
   *   / PersonNotFoundException if the person mappings are invalid
   */
  async create(
    tenantId: string,
    dto: CreateDepartmentDto,
  ): Promise<DepartmentWithMappings> {
    const mappings = dto.personMappings ?? [];
    // Validate any client-supplied branchIds against the tenant first (§4.7).
    // Done on the base client before opening the RLS transaction (mirrors
    // ScheduleService/MasterDataService).
    await this.validateBranches(tenantId, mappings);
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { departmentCounter: { increment: 1 } },
          select: { departmentCounter: true, name: true },
        });
        // 0-based sequence: the first department in a tenant is `…-Dep-0`. The
        // counter is post-increment, so subtract 1 for this department's index.
        const sequence = tenant.departmentCounter - 1;
        const code = `${this.buildInitials(tenant.name)}-Dep-${sequence}`;

        await this.validatePersonMappings(tx, tenantId, mappings);

        return tx.department.create({
          data: {
            tenantId,
            name: dto.name,
            shortName: dto.shortName,
            description: dto.description ?? null,
            code,
            isActive: dto.isActive ?? true,
            moduleMapping: dto.moduleMapping,
            personMappings: {
              create: mappings.map((m) => this.toMappingCreate(tenantId, m)),
            },
          },
          include: MAPPINGS_INCLUDE,
        });
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name, dto.shortName);
      throw e;
    }
  }

  /**
   * Fetch one active department scoped to its tenant, with active person
   * mappings.
   * @param id department id
   * @param tenantId tenant scope
   * @throws DepartmentNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<DepartmentWithMappings> {
    const department = await this.prisma.department.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: MAPPINGS_INCLUDE,
    });
    if (!department) {
      throw new DepartmentNotFoundException(id);
    }
    return department;
  }

  /**
   * List active departments for a tenant (offset pagination), each with its
   * active person mappings.
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (matched against `name`
   *   or `code`), an active/inactive `status` filter, and a `moduleMapping`
   *   branch-type filter (matches departments whose `moduleMapping` includes it)
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
    filters: {
      search?: string;
      status?: 'ACTIVE' | 'INACTIVE';
      moduleMapping?: BranchType;
    } = {},
  ): Promise<PaginatedResult<DepartmentWithMappings>> {
    const where: Prisma.DepartmentWhereInput = { tenantId, deletedAt: null };
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
    if (filters.moduleMapping) {
      where.moduleMapping = { has: filters.moduleMapping };
    }
    // Sequential (not array-`$transaction`) so each call flows through the RLS
    // extension and carries the tenant GUC when RLS is enabled.
    const data = await this.prisma.department.findMany({
      where,
      include: MAPPINGS_INCLUDE,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.department.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update a department. `code` is immutable and never changes. When
   * `personMappings` is supplied it REPLACES the whole set: existing active
   * mappings are soft-deleted and the new set is created (validated first), all
   * inside one transaction.
   * @param id department id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws DepartmentNotFoundException if missing/soft-deleted
   * @throws DepartmentNameConflictException on a name collision
   * @throws DepartmentShortNameConflictException on a shortName collision
   * @throws InvalidDepartmentPriorityException / DuplicateDefaultPositionException
   *   / PersonNotFoundException if the replacement mappings are invalid
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateDepartmentDto,
  ): Promise<DepartmentWithMappings> {
    await this.findById(id, tenantId);
    if (dto.personMappings !== undefined) {
      // Validate branchIds before the RLS transaction (§4.7), as in create().
      await this.validateBranches(tenantId, dto.personMappings);
    }
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const data: Prisma.DepartmentUpdateInput = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.shortName !== undefined) data.shortName = dto.shortName;
        if (dto.description !== undefined) {
          data.description = dto.description ?? null;
        }
        if (dto.isActive !== undefined) data.isActive = dto.isActive;
        if (dto.moduleMapping !== undefined) {
          data.moduleMapping = dto.moduleMapping;
        }
        // `code` is immutable and system-generated — never updated here.

        if (dto.personMappings !== undefined) {
          await this.validatePersonMappings(
            tx,
            tenantId,
            dto.personMappings,
            id,
          );
          // Replace the set: soft-delete the current active rows, create anew.
          await tx.departmentPersonMapping.updateMany({
            where: { departmentId: id, tenantId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          data.personMappings = {
            create: dto.personMappings.map((m) =>
              this.toMappingCreate(tenantId, m),
            ),
          };
        }

        return tx.department.update({
          where: { id },
          data,
          include: MAPPINGS_INCLUDE,
        });
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name ?? '', dto.shortName ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a department and its active person mappings (sets `deletedAt`;
   * rows are preserved) in one transaction.
   * @param id department id
   * @param tenantId tenant scope
   * @throws DepartmentNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<DepartmentWithMappings> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.departmentPersonMapping.updateMany({
        where: { departmentId: id, tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return tx.department.update({
        where: { id },
        data: { deletedAt: new Date() },
        include: MAPPINGS_INCLUDE,
      });
    });
  }

  // ── Site Admin global templates ─────────────────────────────────────────────

  /**
   * Create a SITE_ADMIN global department template (no tenant/branch, no person
   * mappings). The `code` is system-generated `SA-Dep-{n}` from the global
   * `SiteAdminCounter` singleton (0-based, post-increment). Runs in a plain
   * transaction — there is no tenant GUC, so RLS lets a GUC-less SiteAdmin
   * connection write the NULL-tenant row.
   * @param dto validated template payload (no `code` — generated here)
   * @returns the created template
   * @throws DepartmentNameConflictException / DepartmentShortNameConflictException
   *   on a clash with another active template
   */
  async createTemplate(
    dto: CreateDepartmentTemplateDto,
  ): Promise<DepartmentEntity> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const code = await this.mintTemplateCode(tx);
        const created = await tx.department.create({
          data: {
            tenantId: null,
            source: DataSource.SITE_ADMIN,
            name: dto.name,
            shortName: dto.shortName,
            description: dto.description ?? null,
            code,
            isActive: dto.isActive ?? true,
            moduleMapping: dto.moduleMapping,
          },
        });
        return created.id;
      });
      return this.findTemplateById(id);
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name, dto.shortName);
      throw e;
    }
  }

  /**
   * List active SITE_ADMIN department templates (offset pagination).
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (name/code), an
   *   active/inactive `status` filter, and a `moduleMapping` branch-type filter
   */
  async findAllTemplates(
    page = 1,
    limit = 20,
    filters: {
      search?: string;
      status?: 'ACTIVE' | 'INACTIVE';
      moduleMapping?: BranchType;
    } = {},
  ): Promise<PaginatedResult<DepartmentEntity>> {
    const where: Prisma.DepartmentWhereInput = {
      source: DataSource.SITE_ADMIN,
      tenantId: null,
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
    if (filters.moduleMapping) {
      where.moduleMapping = { has: filters.moduleMapping };
    }
    const data = await this.prisma.department.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.department.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active SITE_ADMIN department template.
   * @param id template id
   * @throws DepartmentNotFoundException if missing/soft-deleted/not a template
   */
  async findTemplateById(id: string): Promise<DepartmentEntity> {
    const department = await this.prisma.department.findFirst({
      where: {
        id,
        source: DataSource.SITE_ADMIN,
        tenantId: null,
        deletedAt: null,
      },
    });
    if (!department) {
      throw new DepartmentNotFoundException(id);
    }
    return department;
  }

  /**
   * Update a SITE_ADMIN department template. `code` is immutable; `source` and
   * the NULL tenant are fixed.
   * @param id template id
   * @param dto partial update
   * @throws DepartmentNotFoundException if missing/soft-deleted/not a template
   * @throws DepartmentNameConflictException / DepartmentShortNameConflictException
   *   on a clash with another active template
   */
  async updateTemplate(
    id: string,
    dto: UpdateDepartmentTemplateDto,
  ): Promise<DepartmentEntity> {
    await this.findTemplateById(id);
    const data: Prisma.DepartmentUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.shortName !== undefined) data.shortName = dto.shortName;
    if (dto.description !== undefined)
      data.description = dto.description ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.moduleMapping !== undefined) data.moduleMapping = dto.moduleMapping;
    try {
      return await this.prisma.department.update({ where: { id }, data });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name ?? '', dto.shortName ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a SITE_ADMIN department template (sets `deletedAt`).
   * @param id template id
   * @throws DepartmentNotFoundException if missing/soft-deleted/not a template
   */
  async removeTemplate(id: string): Promise<DepartmentEntity> {
    await this.findTemplateById(id);
    return this.prisma.department.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Clone / adoption (SITE_ADMIN template → tenant) ──────────────────────────

  /**
   * Adopt a SITE_ADMIN department template into the caller's tenant catalogue.
   * `tenantId` comes from the JWT; a fresh tenant `code` (`{INITIALS}-Dep-{n}`)
   * is minted (the template's `SA-Dep-{n}` is not kept). If the template was
   * already cloned into this tenant, the existing copy is returned (no
   * duplicate). Fully transactional.
   * @param templateId the SITE_ADMIN template to clone
   * @param tenantId caller's tenant
   * @returns the tenant department (existing clone or newly created)
   * @throws DepartmentNotFoundException if `templateId` is not a live template
   * @throws DepartmentNameConflictException / DepartmentShortNameConflictException
   *   if the clone's name/shortName clashes with an existing tenant department
   */
  async cloneToTenant(
    templateId: string,
    tenantId: string,
  ): Promise<DepartmentWithMappings> {
    let newId: string;
    try {
      newId = await this.prisma.withTenant(tenantId, async (tx) => {
        const cloned = await this.cloneTemplateWithinTx(
          tx,
          templateId,
          tenantId,
        );
        return cloned.id;
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, '', '');
      throw e;
    }
    return this.findById(newId, tenantId);
  }

  /**
   * Clone a SITE_ADMIN department template into a tenant within an EXISTING
   * transaction — reused by CategoryService / SubCategoryService when cascading a
   * parent-department clone, so the whole chain shares one transaction. Reuses an
   * existing clone (matched by `clonedFromId`) when present. The new row is
   * `source = TENANT` with a fresh tenant `code` and `clonedFromId` set; person
   * mappings are NOT copied (templates have none).
   * @param tx the caller's transaction client (already in `withTenant`)
   * @param templateId the SITE_ADMIN template department to clone
   * @param tenantId target tenant
   * @returns the tenant department (existing clone or newly created)
   * @throws DepartmentNotFoundException if `templateId` is not a live template
   */
  async cloneTemplateWithinTx(
    tx: Prisma.TransactionClient,
    templateId: string,
    tenantId: string,
  ): Promise<DepartmentEntity> {
    const existing = await tx.department.findFirst({
      where: { tenantId, clonedFromId: templateId, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    const template = await tx.department.findFirst({
      where: {
        id: templateId,
        source: DataSource.SITE_ADMIN,
        tenantId: null,
        deletedAt: null,
      },
    });
    if (!template) {
      throw new DepartmentNotFoundException(templateId);
    }
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { departmentCounter: { increment: 1 } },
      select: { departmentCounter: true, name: true },
    });
    const code = `${this.buildInitials(tenant.name)}-Dep-${tenant.departmentCounter - 1}`;
    return tx.department.create({
      data: {
        tenantId,
        source: DataSource.TENANT,
        clonedFromId: templateId,
        name: template.name,
        shortName: template.shortName,
        description: template.description,
        code,
        isActive: template.isActive,
        moduleMapping: template.moduleMapping,
      },
    });
  }

  /**
   * Take the next global template sequence from the `SiteAdminCounter` singleton
   * (upserting it on first use) and format the code `SA-Dep-{n}` (0-based, the
   * counter is post-increment). Runs inside the template-create transaction.
   * @param tx active transaction client
   */
  private async mintTemplateCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const counter = await tx.siteAdminCounter.upsert({
      where: { id: SITE_ADMIN_COUNTER_ID },
      create: { id: SITE_ADMIN_COUNTER_ID, departmentCounter: 1 },
      update: { departmentCounter: { increment: 1 } },
      select: { departmentCounter: true },
    });
    return `SA-Dep-${counter.departmentCounter - 1}`;
  }

  /**
   * Validate that every client-supplied `branchId` belongs to the caller's
   * tenant (CLAUDE.md §4.7 — never trust a branchId from the body). Runs on the
   * base client, before the RLS transaction is opened. Mappings without a
   * `branchId` are tenant-level and skipped.
   * @param tenantId tenant scope
   * @param mappings incoming mappings
   * @throws BranchNotFoundException if a branch is missing or in another tenant
   */
  private async validateBranches(
    tenantId: string,
    mappings: DepartmentPersonMappingDto[],
  ): Promise<void> {
    const branchIds = [
      ...new Set(
        mappings
          .map((m) => m.branchId)
          .filter((b): b is string => b !== undefined),
      ),
    ];
    for (const branchId of branchIds) {
      await this.branchService.findById(branchId, tenantId);
    }
  }

  /**
   * Validate a set of person mappings before persisting (CLAUDE.md rule #2 —
   * the dynamic checks here can't be expressed with class-validator). All checks
   * are scoped per branch (a tenant-level mapping with no `branchId` forms its
   * own group), so one department can hold different personnel per branch:
   *  - at most one `isDefault` mapping per (branch, position) in the incoming set;
   *  - each `priority` is in `[1, max]`, where `max` is, for that mapping's
   *    branch, the tenant's active mappings for the same branch (outside this
   *    department) plus the incoming rows for that branch;
   *  - every referenced party exists and is active in the table its `type`
   *    resolves to.
   * @param tx active tenant transaction client
   * @param tenantId tenant scope
   * @param mappings incoming mappings
   * @param excludeDepartmentId department whose existing rows are being replaced
   *   (omitted on create)
   * @throws DuplicateDefaultPositionException / InvalidDepartmentPriorityException
   *   / PersonNotFoundException / InvalidPersonMappingReferenceException
   */
  private async validatePersonMappings(
    tx: Prisma.TransactionClient,
    tenantId: string,
    mappings: DepartmentPersonMappingDto[],
    excludeDepartmentId?: string,
  ): Promise<void> {
    if (mappings.length === 0) {
      return;
    }

    // At most one default per (branch, position) in the incoming set.
    const defaultsByBranchPosition = new Map<string, number>();
    for (const m of mappings) {
      if (m.isDefault) {
        const key = `${m.branchId ?? '∅'}|${m.position}`;
        const count = (defaultsByBranchPosition.get(key) ?? 0) + 1;
        if (count > 1) {
          throw new DuplicateDefaultPositionException(m.position);
        }
        defaultsByBranchPosition.set(key, count);
      }
    }

    // Priority cap is per branch: existing active mappings for the same branch
    // (outside this department) + the incoming rows for that branch.
    const incomingByBranch = new Map<
      string | null,
      DepartmentPersonMappingDto[]
    >();
    for (const m of mappings) {
      const branchKey = m.branchId ?? null;
      const group = incomingByBranch.get(branchKey) ?? [];
      group.push(m);
      incomingByBranch.set(branchKey, group);
    }
    for (const [branchId, group] of incomingByBranch) {
      const existing = await tx.departmentPersonMapping.count({
        where: {
          tenantId,
          branchId,
          deletedAt: null,
          ...(excludeDepartmentId
            ? { departmentId: { not: excludeDepartmentId } }
            : {}),
        },
      });
      const max = existing + group.length;
      for (const m of group) {
        if (m.priority < 1 || m.priority > max) {
          throw new InvalidDepartmentPriorityException(m.priority, max);
        }
      }
    }

    await this.validateReferences(tx, tenantId, mappings);
  }

  /**
   * Verify every mapping's `personId` resolves to an active row in the table its
   * `type` points at: USER → persons, CONSULTANT_DOCTOR/REPORTING_DOCTOR →
   * doctors (with a matching `doctorType`), EXTERNAL_REFERRAL →
   * external_referrals. Ids are grouped by type and checked in bulk.
   * @param tx active tenant transaction client
   * @param tenantId tenant scope (doctors/referrals are tenant-scoped)
   * @param mappings incoming mappings
   * @throws PersonNotFoundException for a missing USER reference
   * @throws InvalidPersonMappingReferenceException for a missing/mismatched
   *   doctor or external-referral reference
   */
  private async validateReferences(
    tx: Prisma.TransactionClient,
    tenantId: string,
    mappings: DepartmentPersonMappingDto[],
  ): Promise<void> {
    const userIds = new Set<string>();
    const consultantIds = new Set<string>();
    const reportingIds = new Set<string>();
    const referralIds = new Set<string>();
    for (const m of mappings) {
      switch (m.type ?? PersonMappingType.USER) {
        case PersonMappingType.CONSULTANT_DOCTOR:
          consultantIds.add(m.personId);
          break;
        case PersonMappingType.REPORTING_DOCTOR:
          reportingIds.add(m.personId);
          break;
        case PersonMappingType.EXTERNAL_REFERRAL:
          referralIds.add(m.personId);
          break;
        default:
          userIds.add(m.personId);
      }
    }

    // USER → persons (platform-level, not tenant-scoped).
    if (userIds.size > 0) {
      const found = await tx.person.findMany({
        where: { id: { in: [...userIds] }, deletedAt: null },
        select: { id: true },
      });
      const foundIds = new Set(found.map((p) => p.id));
      for (const id of userIds) {
        if (!foundIds.has(id)) {
          throw new PersonNotFoundException(id);
        }
      }
    }

    // CONSULTANT_DOCTOR / REPORTING_DOCTOR → doctors, matching doctorType.
    await this.assertDoctors(
      tx,
      tenantId,
      consultantIds,
      DoctorType.CONSULTANT,
      PersonMappingType.CONSULTANT_DOCTOR,
    );
    await this.assertDoctors(
      tx,
      tenantId,
      reportingIds,
      DoctorType.REPORTING,
      PersonMappingType.REPORTING_DOCTOR,
    );

    // EXTERNAL_REFERRAL → external_referrals (tenant-scoped).
    if (referralIds.size > 0) {
      const found = await tx.externalReferral.findMany({
        where: { id: { in: [...referralIds] }, tenantId, deletedAt: null },
        select: { id: true },
      });
      const foundIds = new Set(found.map((r) => r.id));
      for (const id of referralIds) {
        if (!foundIds.has(id)) {
          throw new InvalidPersonMappingReferenceException(
            PersonMappingType.EXTERNAL_REFERRAL,
            id,
          );
        }
      }
    }
  }

  /**
   * Assert each id is an active doctor of this tenant with the expected
   * `doctorType` (so a CONSULTANT_DOCTOR mapping can't point at a REPORTING
   * doctor and vice-versa).
   * @param tx active tenant transaction client
   * @param tenantId tenant scope
   * @param ids doctor ids to verify (no-op when empty)
   * @param doctorType the doctorType the referenced doctors must have
   * @param mappingType the mapping type (for the thrown error's context)
   * @throws InvalidPersonMappingReferenceException on any missing/mismatched id
   */
  private async assertDoctors(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ids: Set<string>,
    doctorType: DoctorType,
    mappingType: PersonMappingType,
  ): Promise<void> {
    if (ids.size === 0) {
      return;
    }
    const found = await tx.doctor.findMany({
      where: { id: { in: [...ids] }, tenantId, doctorType, deletedAt: null },
      select: { id: true },
    });
    const foundIds = new Set(found.map((d) => d.id));
    for (const id of ids) {
      if (!foundIds.has(id)) {
        throw new InvalidPersonMappingReferenceException(mappingType, id);
      }
    }
  }

  /**
   * Shape a validated mapping DTO into a nested-create row, stamping the tenant.
   * `type` defaults to USER and `branchId` to null (tenant-level) when omitted.
   * @param tenantId tenant scope (set from context, never the body)
   * @param m the validated mapping
   */
  private toMappingCreate(
    tenantId: string,
    m: DepartmentPersonMappingDto,
  ): Prisma.DepartmentPersonMappingCreateWithoutDepartmentInput {
    return {
      tenantId,
      personId: m.personId,
      type: m.type ?? PersonMappingType.USER,
      branchId: m.branchId ?? null,
      position: m.position,
      isSignatory: m.isSignatory ?? false,
      priority: m.priority,
      isDefault: m.isDefault ?? false,
    };
  }

  /**
   * Derive a department-code prefix from a tenant name: the first letter of up
   * to the first three words, uppercased, letters only (e.g. "Apex Bio Care" →
   * "ABC"). Falls back to "DEP" when the name has no letters.
   * @param name the tenant's business name
   */
  private buildInitials(name: string): string {
    const initials = name
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .slice(0, 3)
      .map((w) => w.replace(/[^a-zA-Z]/g, '').charAt(0))
      .filter((c) => c.length > 0)
      .join('')
      .toUpperCase();
    return initials.length > 0 ? initials : 'DEP';
  }

  /**
   * If the caught error is a Prisma unique-constraint violation (P2002), throw
   * the matching typed 409. Two user-set unique indexes exist per tenant
   * (`name` and `short_name`); the violated index name arrives in
   * `error.meta.target`, so we check `short_name` first (it contains `name` as a
   * substring). Returns normally for any other error so the caller can rethrow.
   * @param e the caught error
   * @param name the attempted name (for the conflict's context)
   * @param shortName the attempted shortName (for the conflict's context)
   * @throws DepartmentShortNameConflictException / DepartmentNameConflictException
   */
  private rethrowUniqueViolation(
    e: unknown,
    name: string,
    shortName: string,
  ): void {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== 'P2002'
    ) {
      return;
    }
    const target = String(
      (e.meta as { target?: string | string[] } | undefined)?.target ?? '',
    );
    if (target.includes('short_name')) {
      throw new DepartmentShortNameConflictException(shortName);
    }
    throw new DepartmentNameConflictException(name);
  }
}
