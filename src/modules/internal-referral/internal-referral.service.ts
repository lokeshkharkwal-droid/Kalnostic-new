import { Injectable } from '@nestjs/common';
import {
  CommissionMode,
  CommissionType,
  FixedCommissionCycle,
  InternalReferralStatus,
  PaymentCycle,
  Prisma,
  ReferralPaymentMode,
  ReferralType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { DepartmentService } from '../department/department.service';
import { UsersService } from '../users/users.service';
import { ReferralListAssignmentService } from '../referral-list/referral-list-assignment.service';
import { ReferralPanelSettingsService } from '../referral-panel-settings/referral-panel-settings.service';
import { CreateInternalReferralDto } from './dto/create-internal-referral.dto';
import { UpdateInternalReferralDto } from './dto/update-internal-referral.dto';
import { ListInternalReferralsDto } from './dto/list-internal-referrals.dto';
import {
  BonusSlab,
  CommissionSlab,
  INTERNAL_REFERRAL_DETAIL_INCLUDE,
  INTERNAL_REFERRAL_LIST_SELECT,
  InternalReferralDetail,
  InternalReferralListItem,
  InternalReferralWithRelations,
} from './entities/internal-referral.entity';
import {
  InternalReferralNotFoundException,
  InvalidCommissionConfigException,
  InvalidEmployeeRefException,
} from './exceptions/internal-referral.exceptions';

/** The effective commission settings used for validation + normalisation. */
interface CommissionEffective {
  isCommissionApplicable: boolean;
  commissionType: CommissionType | null;
  commissionPctLabTest: number | null;
  commissionPctLabPanel: number | null;
  commissionSlabs: CommissionSlab[];
  fixedCommissionCycle: FixedCommissionCycle | null;
  fixedAmount: number | null;
}

/** The normalised commission columns written to the `internal_referrals` row. */
interface CommissionColumns {
  isCommissionApplicable: boolean;
  commissionType: CommissionType | null;
  commissionPctLabTest: number | null;
  commissionPctLabPanel: number | null;
  commissionSlabs: CommissionSlab[];
  fixedCommissionCycle: FixedCommissionCycle | null;
  fixedAmount: number | null;
}

/**
 * Internal-referral registry management. Tenant-scoped, tenant-level (CLAUDE.md
 * §4.6): the registry of employees who refer lab work belongs to the business as a
 * whole, not a branch. Every query carries `tenantId` (defence in depth on top of
 * RLS, §4.3) and filters soft-deleted rows. An optional `employeeId` is validated via
 * the injected `UsersService` to be an active staff member of the caller's tenant
 * (CLAUDE.md rule #3 — never import another service's file directly). The assigned
 * Lab Test / Lab Panel List is a per-branch `ReferralListAssignment` managed via
 * `ReferralListAssignmentService`. Commission/incentive config is validated against
 * the effective (merged, on update) state and the stored data is normalised so
 * dependent fields are nulled out when they don't apply.
 */
@Injectable()
export class InternalReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly referralPanelSettingsService: ReferralPanelSettingsService,
    private readonly branchService: BranchService,
    private readonly departmentService: DepartmentService,
    private readonly listAssignmentService: ReferralListAssignmentService,
  ) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /internal-referrals/options`). Tenant-scoped to non-deleted internal
   * referrals; optionally filtered by a case-insensitive `firstName` search. The
   * `name` prefers the stored `fullName`, falling back to first + last name.
   * Returns the full array when `page` is omitted, or a paginated envelope when
   * `page` is supplied.
   * @param tenantId tenant scope
   * @param filters optional `search` and opt-in `page`/`limit`
   * @returns the full `{ id, name }[]` array, or a paginated `{ data, total, page, limit }` envelope
   */
  async findOptions(
    tenantId: string,
    filters: {
      search?: string;
      branchId?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<
    | Array<{ id: string; name: string }>
    | PaginatedResult<{ id: string; name: string }>
  > {
    const where: Prisma.InternalReferralWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
        { mobileNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const select = {
      id: true,
      firstName: true,
      lastName: true,
      fullName: true,
    } as const;
    const orderBy = { firstName: 'asc' } as const;
    const toName = (r: {
      firstName: string;
      lastName: string | null;
      fullName: string | null;
    }) =>
      r.fullName?.trim() || [r.firstName, r.lastName].filter(Boolean).join(' ');

    if (filters.page === undefined) {
      const rows = await this.prisma.internalReferral.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: toName(r) }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.internalReferral.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.internalReferral.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: toName(r) })),
      total,
      page,
      limit,
    };
  }

  /**
   * Validate that a referenced settings template exists in the caller's tenant.
   * No-op when no id is supplied.
   * @param tenantId tenant scope
   * @param referralPanelSettingsId the settings id to validate (or undefined/null)
   * @throws ReferralPanelSettingsNotFoundException if missing/other tenant
   */
  private async assertSettingsRef(
    tenantId: string,
    referralPanelSettingsId?: string | null,
  ): Promise<void> {
    if (referralPanelSettingsId) {
      await this.referralPanelSettingsService.findById(
        referralPanelSettingsId,
        tenantId,
      );
    }
  }

  /**
   * Validate that a referenced branch belongs to the caller's tenant (CLAUDE.md
   * §4.7 — never trust a client-supplied `branchId`). No-op when none is supplied.
   * @param tenantId tenant scope
   * @param branchId the branch id to validate (or undefined/null)
   * @throws BranchNotFoundException if missing/other tenant
   */
  private async assertBranchRef(
    tenantId: string,
    branchId?: string | null,
  ): Promise<void> {
    if (branchId) {
      await this.branchService.findById(branchId, tenantId);
    }
  }

  /**
   * Validate that a referenced department belongs to the caller's tenant
   * (mirrors ReferralDoctorService's classification validation). No-op when none
   * is supplied.
   * @param tenantId tenant scope
   * @param departmentId the department id to validate (or undefined/null)
   * @throws DepartmentNotFoundException if missing/other tenant
   */
  private async assertDepartmentRef(
    tenantId: string,
    departmentId?: string | null,
  ): Promise<void> {
    if (departmentId) {
      await this.departmentService.findById(departmentId, tenantId);
    }
  }

  /**
   * Register an internal referral in one transaction. The optional `employeeId` is
   * validated to be active staff of the tenant; commission/incentive config is
   * validated and normalised. When an active branch is supplied, the chosen
   * per-branch Lab Test / Lab Panel List is attached via
   * `ReferralListAssignmentService`.
   * @param tenantId owning tenant (from the JWT, never the body)
   * @param branchId active branch from the JWT (null → no list assignment written)
   * @param actorId person id recorded as created-by on the list assignment (or null)
   * @param dto validated payload
   * @returns the created internal referral with the resolved list assignment
   * @throws InvalidEmployeeRefException if `employeeId` isn't active staff of the tenant
   * @throws InvalidCommissionConfigException on a commission/incentive invariant
   */
  async create(
    tenantId: string,
    branchId: string | null,
    actorId: string | null,
    dto: CreateInternalReferralDto,
  ): Promise<InternalReferralDetail> {
    await this.validateEmployee(tenantId, dto.employeeId);
    await this.assertSettingsRef(tenantId, dto.referralPanelSettingsId);
    await this.assertBranchRef(tenantId, dto.branchId);
    await this.assertDepartmentRef(tenantId, dto.departmentId);

    const commissionEff: CommissionEffective = {
      isCommissionApplicable: dto.isCommissionApplicable ?? false,
      commissionType: dto.commissionType ?? null,
      commissionPctLabTest: dto.commissionPctLabTest ?? null,
      commissionPctLabPanel: dto.commissionPctLabPanel ?? null,
      commissionSlabs: dto.commissionSlabs ?? [],
      fixedCommissionCycle: dto.fixedCommissionCycle ?? null,
      fixedAmount: dto.fixedAmount ?? null,
    };
    this.assertCommission(commissionEff);
    const incentive = dto.isIncentiveBonusApplicable ?? false;
    const bonusSlabs: BonusSlab[] = dto.bonusSlabs ?? [];
    this.assertBonus(incentive, bonusSlabs);

    const data: Prisma.InternalReferralUncheckedCreateInput = {
      tenantId,
      branchId: dto.branchId ?? null,
      referralPanelSettingsId: dto.referralPanelSettingsId ?? null,
      // Employee details
      employeeId: dto.employeeId ?? null,
      firstName: dto.firstName,
      lastName: dto.lastName ?? null,
      fullName: this.computeFullName(dto.firstName, dto.lastName ?? null),
      departmentId: dto.departmentId ?? null,
      designation: dto.designation ?? null,
      joiningDate: this.toDate(dto.joiningDate),
      mobileNumber: dto.mobileNumber ?? null,
      email: dto.email ?? null,
      city: dto.city ?? null,
      state: dto.state ?? null,
      pincode: dto.pincode ?? null,
      // Commission (normalised)
      ...this.normalizeCommission(commissionEff),
      isTdsApplicable: dto.isTdsApplicable ?? false,
      tds: dto.isTdsApplicable ? (dto.tds ?? null) : null,
      // Payroll & payment
      isIncludedInPayroll: dto.isIncludedInPayroll ?? false,
      paymentCycle: dto.paymentCycle ?? PaymentCycle.MONTHLY,
      paymentMode: dto.paymentMode ?? ReferralPaymentMode.BANK_TRANSFER,
      commissionMode: dto.commissionMode ?? CommissionMode.INCLUDED_IN_SALARY,
      monthlyTargetAmount: dto.monthlyTargetAmount ?? 0,
      isIncentiveBonusApplicable: incentive,
      bonusSlabs: incentive ? bonusSlabs : [],
      // Attachment & remarks
      fileName: dto.fileName ?? null,
      fileUrl: dto.fileUrl ?? null,
      remarks: dto.remarks ?? null,
      status: dto.status ?? InternalReferralStatus.ACTIVE,
    };

    const createdId = await this.prisma.withTenant(tenantId, async (tx) => {
      const referral = await tx.internalReferral.create({ data });
      return referral.id;
    });
    if (branchId) {
      await this.listAssignmentService.upsert(
        tenantId,
        branchId,
        actorId,
        ReferralType.INTERNAL,
        createdId,
        {
          branchLabTestListId: dto.branchLabTestListId,
          branchLabPanelListId: dto.branchLabPanelListId,
        },
      );
    }
    return this.findById(createdId, tenantId, branchId);
  }

  /**
   * List active internal referrals for a tenant (offset pagination), returning the
   * trimmed listing projection. Supports a free-text `search` by employee name
   * (whitespace-tokenised across first/last/full name, with the mobile number as a
   * fallback) plus `status` and `branchId` filters.
   * @param tenantId tenant scope
   * @param query pagination + filters
   */
  async findAllForTenant(
    tenantId: string,
    query: ListInternalReferralsDto,
  ): Promise<PaginatedResult<InternalReferralListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.InternalReferralWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;
    if (query.branchId) where.branchId = query.branchId;
    const term = query.search?.trim();
    if (term) {
      // Search by employee name: split into whitespace tokens and require EACH to
      // match some name part (first/last/full name), with the mobile number as a
      // fallback — so "Anita Sharma" matches first+last and a single token matches
      // any part.
      where.AND = term.split(/\s+/).map((token) => ({
        OR: [
          { firstName: { contains: token, mode: 'insensitive' } },
          { lastName: { contains: token, mode: 'insensitive' } },
          { fullName: { contains: token, mode: 'insensitive' } },
          { mobileNumber: { contains: token, mode: 'insensitive' } },
        ],
      }));
    }

    const [rows, total] = await Promise.all([
      this.prisma.internalReferral.findMany({
        where,
        select: INTERNAL_REFERRAL_LIST_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.internalReferral.count({ where }),
    ]);
    const data: InternalReferralListItem[] = rows;
    return { data, total, page, limit };
  }

  /**
   * Fetch one active internal referral scoped to its tenant. When a branch context
   * is supplied, the active branch's Lab Test / Lab Panel List assignment is
   * prefilled onto the result (both null when no branch context or no assignment).
   * @param id internal referral id
   * @param tenantId tenant scope
   * @param branchId active branch (from JWT); when set, the list assignment is loaded
   * @throws InternalReferralNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ): Promise<InternalReferralDetail> {
    const referral = await this.prisma.internalReferral.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: INTERNAL_REFERRAL_DETAIL_INCLUDE,
    });
    if (!referral) {
      throw new InternalReferralNotFoundException(id);
    }
    return this.toDetail(tenantId, branchId ?? null, referral);
  }

  /**
   * Update an internal referral. Only supplied fields change. When `employeeId` is
   * supplied it is re-validated against the tenant. Commission/incentive config is
   * re-validated and normalised against the merged (existing + patch) state when any
   * related field is present. When an active branch is supplied and either
   * `branchLabTestListId`/`branchLabPanelListId` is present, the per-branch Lab Test
   * / Lab Panel List assignment is re-applied. All in one transaction.
   * @param id internal referral id
   * @param tenantId tenant scope
   * @param branchId active branch from the JWT (null → no list assignment written)
   * @param actorId person id recorded as updated-by on the list assignment (or null)
   * @param dto partial update
   * @throws InternalReferralNotFoundException if missing/soft-deleted
   * @throws InvalidEmployeeRefException / InvalidCommissionConfigException
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string | null,
    dto: UpdateInternalReferralDto,
  ): Promise<InternalReferralDetail> {
    const existing = await this.findById(id, tenantId);
    if (dto.employeeId !== undefined) {
      await this.validateEmployee(tenantId, dto.employeeId);
    }
    await this.assertSettingsRef(tenantId, dto.referralPanelSettingsId);
    await this.assertBranchRef(tenantId, dto.branchId);
    await this.assertDepartmentRef(tenantId, dto.departmentId);

    let data: Prisma.InternalReferralUpdateInput = this.toScalarUpdateData(dto);

    // fullName is never accepted from the client — recompute it whenever either
    // name part is touched, using the existing value as the fallback for the
    // untouched part.
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      data.fullName = this.computeFullName(
        dto.firstName ?? existing.firstName,
        dto.lastName ?? existing.lastName ?? null,
      );
    }

    const commissionTouched =
      dto.isCommissionApplicable !== undefined ||
      dto.commissionType !== undefined ||
      dto.commissionPctLabTest !== undefined ||
      dto.commissionPctLabPanel !== undefined ||
      dto.commissionSlabs !== undefined ||
      dto.fixedCommissionCycle !== undefined ||
      dto.fixedAmount !== undefined;
    if (commissionTouched) {
      const eff: CommissionEffective = {
        isCommissionApplicable:
          dto.isCommissionApplicable ?? existing.isCommissionApplicable,
        commissionType: dto.commissionType ?? existing.commissionType,
        commissionPctLabTest:
          dto.commissionPctLabTest ??
          this.decToNum(existing.commissionPctLabTest),
        commissionPctLabPanel:
          dto.commissionPctLabPanel ??
          this.decToNum(existing.commissionPctLabPanel),
        commissionSlabs:
          dto.commissionSlabs ??
          this.asCommissionSlabs(existing.commissionSlabs),
        fixedCommissionCycle:
          dto.fixedCommissionCycle ?? existing.fixedCommissionCycle,
        fixedAmount: dto.fixedAmount ?? this.decToNum(existing.fixedAmount),
      };
      this.assertCommission(eff);
      data = { ...data, ...this.normalizeCommission(eff) };
    }

    const bonusTouched =
      dto.isIncentiveBonusApplicable !== undefined ||
      dto.bonusSlabs !== undefined;
    if (bonusTouched) {
      const incentive =
        dto.isIncentiveBonusApplicable ?? existing.isIncentiveBonusApplicable;
      const slabs: BonusSlab[] =
        dto.bonusSlabs ?? this.asBonusSlabs(existing.bonusSlabs);
      this.assertBonus(incentive, slabs);
      data = {
        ...data,
        isIncentiveBonusApplicable: incentive,
        bonusSlabs: incentive ? slabs : [],
      };
    }

    // TDS percentage is normalised against the effective applicability: cleared to
    // null when TDS doesn't apply, otherwise the patched (or existing) value.
    if (dto.isTdsApplicable !== undefined || dto.tds !== undefined) {
      const tdsApplicable = dto.isTdsApplicable ?? existing.isTdsApplicable;
      data.tds = tdsApplicable ? (dto.tds ?? existing.tds ?? null) : null;
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.internalReferral.update({ where: { id }, data });
    });

    if (
      branchId &&
      (dto.branchLabTestListId !== undefined ||
        dto.branchLabPanelListId !== undefined)
    ) {
      await this.listAssignmentService.upsert(
        tenantId,
        branchId,
        actorId,
        ReferralType.INTERNAL,
        id,
        {
          branchLabTestListId: dto.branchLabTestListId,
          branchLabPanelListId: dto.branchLabPanelListId,
        },
      );
    }
    return this.findById(id, tenantId, branchId);
  }

  /**
   * Soft-delete an internal referral. The per-branch list assignment is left as-is
   * (it resolves against the referral only while the referral is active).
   * @param id internal referral id
   * @param tenantId tenant scope
   * @throws InternalReferralNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<InternalReferralDetail> {
    await this.findById(id, tenantId);
    const now = new Date();
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.internalReferral.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
    // Re-fetch ignoring the soft-delete filter so the caller gets the final state.
    const removed = await this.prisma.internalReferral.findUnique({
      where: { id },
      include: INTERNAL_REFERRAL_DETAIL_INCLUDE,
    });
    // `removed` is guaranteed present (we just updated it); narrow for the type.
    return this.toDetail(
      tenantId,
      null,
      removed as InternalReferralWithRelations,
    );
  }

  // ── Validation helpers ──────────────────────────────────────────────────────

  /**
   * Validate the optional employee link: when present, the `employeeId` must
   * reference a Person who is an active staff member of the caller's tenant. No-op
   * when no employee is linked.
   * @param tenantId tenant scope
   * @param employeeId candidate Person id, if any
   * @throws InvalidEmployeeRefException if the person isn't active staff of the tenant
   */
  private async validateEmployee(
    tenantId: string,
    employeeId: string | undefined,
  ): Promise<void> {
    if (!employeeId) return;
    const isStaff = await this.usersService.isActiveStaffOfTenant(
      employeeId,
      tenantId,
    );
    if (!isStaff) {
      throw new InvalidEmployeeRefException(employeeId);
    }
  }

  /**
   * Validate the commission configuration's cross-field invariants: a required type
   * when commission applies, non-empty slabs for SLAB_BASED, a cycle (and a fixed
   * amount for non–ORDER_WISE cycles) for FIXED_AMOUNT, and well-ordered slab bands.
   * @param c the effective commission settings
   * @throws InvalidCommissionConfigException on any violation
   */
  private assertCommission(c: CommissionEffective): void {
    if (c.isCommissionApplicable) {
      if (!c.commissionType) {
        throw new InvalidCommissionConfigException(
          'commissionType is required when commission is applicable',
        );
      }
      if (
        c.commissionType === CommissionType.SLAB_BASED &&
        c.commissionSlabs.length === 0
      ) {
        throw new InvalidCommissionConfigException(
          'at least one commission slab is required for slab-based commission',
        );
      }
      if (c.commissionType === CommissionType.FIXED_AMOUNT) {
        if (!c.fixedCommissionCycle) {
          throw new InvalidCommissionConfigException(
            'fixedCommissionCycle is required for fixed-amount commission',
          );
        }
        if (
          c.fixedCommissionCycle !== FixedCommissionCycle.ORDER_WISE &&
          c.fixedAmount === null
        ) {
          throw new InvalidCommissionConfigException(
            'fixedAmount is required for the selected fixed-commission cycle',
          );
        }
      }
    }
    for (const s of c.commissionSlabs) {
      if (s.monthlyBusinessFrom > s.monthlyBusinessTo) {
        throw new InvalidCommissionConfigException(
          'commission slab monthlyBusinessFrom must be <= monthlyBusinessTo',
        );
      }
      // Catches a slab row added via "Add More Slabs" and left untouched (the
      // UI's default is {from: 0, to: 0, pct: 0}) — a genuine ₹0-anchored slab
      // (e.g. ₹0–50,000) always has to > from, so this exact combination can
      // only be the untouched default, never a real band.
      if (
        s.monthlyBusinessFrom === 0 &&
        s.monthlyBusinessTo === 0 &&
        s.commissionPct === 0
      ) {
        throw new InvalidCommissionConfigException(
          'commission slab rows must be filled in — remove any empty slab left at its default values',
        );
      }
    }
  }

  /**
   * Validate the incentive-bonus configuration: non-empty slabs when applicable and
   * well-ordered slab bands.
   * @param applicable whether incentive bonus applies
   * @param slabs the bonus slabs
   * @throws InvalidCommissionConfigException on any violation
   */
  private assertBonus(applicable: boolean, slabs: BonusSlab[]): void {
    if (applicable && slabs.length === 0) {
      throw new InvalidCommissionConfigException(
        'at least one bonus slab is required when incentive bonus is applicable',
      );
    }
    for (const s of slabs) {
      if (s.monthlyBusinessFrom > s.monthlyBusinessTo) {
        throw new InvalidCommissionConfigException(
          'bonus slab monthlyBusinessFrom must be <= monthlyBusinessTo',
        );
      }
      // Same untouched-default check as assertCommission's slab loop.
      if (
        s.monthlyBusinessFrom === 0 &&
        s.monthlyBusinessTo === 0 &&
        s.bonusPct === 0
      ) {
        throw new InvalidCommissionConfigException(
          'bonus slab rows must be filled in — remove any empty slab left at its default values',
        );
      }
    }
  }

  /**
   * Normalise the commission columns for storage: when commission doesn't apply
   * everything is nulled/emptied; otherwise only the columns relevant to the chosen
   * `commissionType` are kept (others nulled/emptied), and a fixed amount is dropped
   * for an ORDER_WISE cycle.
   * @param c the (already-validated) effective commission settings
   * @returns the commission columns to write
   */
  private normalizeCommission(c: CommissionEffective): CommissionColumns {
    const applicable = c.isCommissionApplicable;
    const type = applicable ? c.commissionType : null;
    const isPct = type === CommissionType.PERCENTAGE;
    const isSlab = type === CommissionType.SLAB_BASED;
    const isFixed = type === CommissionType.FIXED_AMOUNT;
    return {
      isCommissionApplicable: applicable,
      commissionType: type,
      commissionPctLabTest: isPct ? c.commissionPctLabTest : null,
      commissionPctLabPanel: isPct ? c.commissionPctLabPanel : null,
      commissionSlabs: isSlab ? c.commissionSlabs : [],
      fixedCommissionCycle: isFixed ? c.fixedCommissionCycle : null,
      fixedAmount:
        isFixed && c.fixedCommissionCycle !== FixedCommissionCycle.ORDER_WISE
          ? c.fixedAmount
          : null,
    };
  }

  // ── Persistence helpers ─────────────────────────────────────────────────────

  /**
   * Build the scalar update payload (employee/payroll/payment/attachment/status
   * fields) from an update DTO. Only fields present on the DTO are written;
   * commission/incentive and lab-list fields are handled separately.
   * @param dto the update DTO
   */
  private toScalarUpdateData(
    dto: UpdateInternalReferralDto,
  ): Prisma.InternalReferralUpdateInput {
    const data: Prisma.InternalReferralUpdateInput = {};
    // Employee details
    if (dto.employeeId !== undefined) data.employeeId = dto.employeeId ?? null;
    if (dto.branchId !== undefined) data.branchId = dto.branchId ?? null;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName ?? null;
    if (dto.departmentId !== undefined) {
      data.department = dto.departmentId
        ? { connect: { id: dto.departmentId } }
        : { disconnect: true };
    }
    if (dto.designation !== undefined) {
      data.designation = dto.designation ?? null;
    }
    if (dto.joiningDate !== undefined) {
      data.joiningDate = this.toDate(dto.joiningDate);
    }
    if (dto.mobileNumber !== undefined) {
      data.mobileNumber = dto.mobileNumber ?? null;
    }
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.city !== undefined) data.city = dto.city ?? null;
    if (dto.state !== undefined) data.state = dto.state ?? null;
    if (dto.pincode !== undefined) data.pincode = dto.pincode ?? null;
    // Settings template ref
    if (dto.referralPanelSettingsId !== undefined) {
      data.referralPanelSettings = dto.referralPanelSettingsId
        ? { connect: { id: dto.referralPanelSettingsId } }
        : { disconnect: true };
    }
    // TDS
    if (dto.isTdsApplicable !== undefined) {
      data.isTdsApplicable = dto.isTdsApplicable;
    }
    // Payroll & payment
    if (dto.isIncludedInPayroll !== undefined) {
      data.isIncludedInPayroll = dto.isIncludedInPayroll;
    }
    if (dto.paymentCycle !== undefined) data.paymentCycle = dto.paymentCycle;
    if (dto.paymentMode !== undefined) data.paymentMode = dto.paymentMode;
    if (dto.commissionMode !== undefined) {
      data.commissionMode = dto.commissionMode;
    }
    if (dto.monthlyTargetAmount !== undefined) {
      data.monthlyTargetAmount = dto.monthlyTargetAmount;
    }
    // Attachment & remarks
    if (dto.fileName !== undefined) data.fileName = dto.fileName ?? null;
    if (dto.fileUrl !== undefined) data.fileUrl = dto.fileUrl ?? null;
    if (dto.remarks !== undefined) data.remarks = dto.remarks ?? null;
    // Status
    if (dto.status !== undefined) data.status = dto.status;
    return data;
  }

  // ── Response shaping ────────────────────────────────────────────────────────

  /**
   * Compose the GET-single response: attach the active branch's Lab Test / Lab Panel
   * List assignment (both null when there is no branch context or no assignment).
   * @param tenantId tenant scope
   * @param branchId active branch (from JWT) or null
   * @param referral the loaded internal referral with relations
   */
  private async toDetail(
    tenantId: string,
    branchId: string | null,
    referral: InternalReferralWithRelations,
  ): Promise<InternalReferralDetail> {
    const assignment = branchId
      ? await this.listAssignmentService.getAssignment(
          tenantId,
          branchId,
          ReferralType.INTERNAL,
          referral.id,
        )
      : null;

    return {
      ...referral,
      branchLabTestListId: assignment?.branchLabTestListId ?? null,
      branchLabPanelListId: assignment?.branchLabPanelListId ?? null,
    };
  }

  // ── Misc helpers ────────────────────────────────────────────────────────────

  /**
   * Convert an optional ISO date string into a Date (or null when absent), for
   * `@db.Date` columns.
   * @param value an ISO-8601 date string, or undefined
   */
  private toDate(value: string | undefined): Date | null {
    return value ? new Date(value) : null;
  }

  /**
   * Derive the stored `fullName` from first/last name (mirrors
   * ReferralDoctorService.computeFullName). Never accepted from the client.
   * @param first the employee's first name
   * @param last the employee's last name, or null
   */
  private computeFullName(first: string, last: string | null): string {
    return [first, last].filter(Boolean).join(' ');
  }

  /**
   * Coerce a nullable Prisma Decimal column to a plain number (or null) for merging
   * into the effective commission state.
   * @param d the Decimal value (or null)
   */
  private decToNum(d: Prisma.Decimal | null): number | null {
    return d === null ? null : d.toNumber();
  }

  /**
   * Read a JSON commission-slabs column as a typed array (empty if not an array).
   * @param v the stored JSON value
   */
  private asCommissionSlabs(v: Prisma.JsonValue): CommissionSlab[] {
    return Array.isArray(v) ? (v as unknown as CommissionSlab[]) : [];
  }

  /**
   * Read a JSON bonus-slabs column as a typed array (empty if not an array).
   * @param v the stored JSON value
   */
  private asBonusSlabs(v: Prisma.JsonValue): BonusSlab[] {
    return Array.isArray(v) ? (v as unknown as BonusSlab[]) : [];
  }
}
