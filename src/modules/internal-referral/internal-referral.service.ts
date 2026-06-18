import { Injectable } from '@nestjs/common';
import {
  CommissionMode,
  CommissionType,
  FixedCommissionCycle,
  InternalReferralStatus,
  PaymentCycle,
  Prisma,
  ReferralPaymentMode,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { UsersService } from '../users/users.service';
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
  InvalidLabPanelRefException,
  InvalidLabTestRefException,
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
 * (CLAUDE.md rule #3 — never import another service's file directly). Assigned lab
 * tests/panels are managed via the parent (replace-on-update) and validated to be
 * active items in the tenant. Commission/incentive config is validated against the
 * effective (merged, on update) state and the stored data is normalised so dependent
 * fields are nulled out when they don't apply.
 */
@Injectable()
export class InternalReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly referralPanelSettingsService: ReferralPanelSettingsService,
    private readonly branchService: BranchService,
  ) {}

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
   * Register an internal referral with its assigned lab tests/panels in one
   * transaction. The optional `employeeId` is validated to be active staff of the
   * tenant; commission/incentive config is validated and normalised; assigned
   * `labTestId`/`labPanelId`s are validated to be active items in the tenant.
   * @param tenantId owning tenant (from the JWT, never the body)
   * @param dto validated payload
   * @returns the created internal referral with its assigned lab tests/panels
   * @throws InvalidEmployeeRefException if `employeeId` isn't active staff of the tenant
   * @throws InvalidCommissionConfigException on a commission/incentive invariant
   * @throws InvalidLabTestRefException / InvalidLabPanelRefException on a bad ref
   */
  async create(
    tenantId: string,
    dto: CreateInternalReferralDto,
  ): Promise<InternalReferralDetail> {
    await this.validateEmployee(tenantId, dto.employeeId);
    await this.assertSettingsRef(tenantId, dto.referralPanelSettingsId);
    await this.assertBranchRef(tenantId, dto.branchId);

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

    const testIds = dto.labTestIds ?? [];
    const panelIds = dto.labPanelIds ?? [];
    await this.assertLabRefs(tenantId, testIds, panelIds);

    const data: Prisma.InternalReferralUncheckedCreateInput = {
      tenantId,
      branchId: dto.branchId ?? null,
      referralPanelSettingsId: dto.referralPanelSettingsId ?? null,
      // Employee details
      employeeId: dto.employeeId ?? null,
      firstName: dto.firstName,
      lastName: dto.lastName ?? null,
      fullName: dto.fullName ?? null,
      designation: dto.designation ?? null,
      joiningDate: this.toDate(dto.joiningDate),
      mobileNumber: dto.mobileNumber ?? null,
      email: dto.email ?? null,
      // Commission (normalised)
      ...this.normalizeCommission(commissionEff),
      isTdsApplicable: dto.isTdsApplicable ?? false,
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
      await this.writeLabRefs(tx, tenantId, referral.id, testIds, panelIds);
      return referral.id;
    });
    return this.findById(createdId, tenantId);
  }

  /**
   * List active internal referrals for a tenant (offset pagination), returning the
   * trimmed listing projection. Supports a free-text `search` by employee name
   * (whitespace-tokenised across first/last/full name, with the mobile number as a
   * fallback) plus a `status` filter.
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

    const [data, total] = await Promise.all([
      this.prisma.internalReferral.findMany({
        where,
        select: INTERNAL_REFERRAL_LIST_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.internalReferral.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Fetch one active internal referral scoped to its tenant, with all active assigned
   * lab tests/panels (each enriched with the referenced test/panel name + code).
   * @param id internal referral id
   * @param tenantId tenant scope
   * @throws InternalReferralNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<InternalReferralDetail> {
    const referral = await this.prisma.internalReferral.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: INTERNAL_REFERRAL_DETAIL_INCLUDE,
    });
    if (!referral) {
      throw new InternalReferralNotFoundException(id);
    }
    return this.toDetail(tenantId, referral);
  }

  /**
   * Update an internal referral. Only supplied fields change. When `employeeId` is
   * supplied it is re-validated against the tenant. Commission/incentive config is
   * re-validated and normalised against the merged (existing + patch) state when any
   * related field is present. When `labTestIds`/`labPanelIds` is supplied, that whole
   * set is REPLACED (existing active rows soft-deleted, the new set created); omit to
   * leave it unchanged. All in one transaction.
   * @param id internal referral id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws InternalReferralNotFoundException if missing/soft-deleted
   * @throws InvalidEmployeeRefException / InvalidCommissionConfigException /
   *   InvalidLabTestRefException / InvalidLabPanelRefException
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateInternalReferralDto,
  ): Promise<InternalReferralDetail> {
    const existing = await this.findById(id, tenantId);
    if (dto.employeeId !== undefined) {
      await this.validateEmployee(tenantId, dto.employeeId);
    }
    await this.assertSettingsRef(tenantId, dto.referralPanelSettingsId);
    await this.assertBranchRef(tenantId, dto.branchId);

    const testIds = dto.labTestIds;
    const panelIds = dto.labPanelIds;
    if (testIds !== undefined || panelIds !== undefined) {
      await this.assertLabRefs(tenantId, testIds ?? [], panelIds ?? []);
    }

    let data: Prisma.InternalReferralUpdateInput = this.toScalarUpdateData(dto);

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

    const now = new Date();
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.internalReferral.update({ where: { id }, data });

      if (testIds !== undefined) {
        await tx.internalReferralLabTest.updateMany({
          where: { internalReferralId: id, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
      }
      if (panelIds !== undefined) {
        await tx.internalReferralLabPanel.updateMany({
          where: { internalReferralId: id, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
      }
      await this.writeLabRefs(tx, tenantId, id, testIds ?? [], panelIds ?? []);
    });
    return this.findById(id, tenantId);
  }

  /**
   * Soft-delete an internal referral and cascade soft-delete its active assigned lab
   * tests/panels in one transaction.
   * @param id internal referral id
   * @param tenantId tenant scope
   * @throws InternalReferralNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<InternalReferralDetail> {
    await this.findById(id, tenantId);
    const now = new Date();
    const scope = { internalReferralId: id, tenantId, deletedAt: null };
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.internalReferralLabTest.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
      await tx.internalReferralLabPanel.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
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
    return this.toDetail(tenantId, removed as InternalReferralWithRelations);
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
   * Validate the assigned lab-test/panel references: every id must be an active,
   * non-deleted lab test/panel in the caller's tenant. Ids are assumed deduplicated
   * by the DTO (`@ArrayUnique`).
   * @param tenantId tenant scope
   * @param testIds assigned lab-test ids
   * @param panelIds assigned lab-panel ids
   * @throws InvalidLabTestRefException / InvalidLabPanelRefException
   */
  private async assertLabRefs(
    tenantId: string,
    testIds: string[],
    panelIds: string[],
  ): Promise<void> {
    if (testIds.length) {
      const found = await this.prisma.labTest.findMany({
        where: {
          id: { in: testIds },
          tenantId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (found.length !== testIds.length) {
        const ok = new Set(found.map((t) => t.id));
        throw new InvalidLabTestRefException(
          testIds.filter((id) => !ok.has(id)),
        );
      }
    }
    if (panelIds.length) {
      const found = await this.prisma.labPanel.findMany({
        where: {
          id: { in: panelIds },
          tenantId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (found.length !== panelIds.length) {
        const ok = new Set(found.map((p) => p.id));
        throw new InvalidLabPanelRefException(
          panelIds.filter((id) => !ok.has(id)),
        );
      }
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
   * Persist an internal referral's assigned lab tests and lab panels. Assumes the ids
   * were already validated by `assertLabRefs` (no-op for empty lists).
   * @param tx active transaction client
   * @param tenantId tenant scope
   * @param internalReferralId owning internal referral
   * @param testIds assigned lab-test ids
   * @param panelIds assigned lab-panel ids
   */
  private async writeLabRefs(
    tx: Prisma.TransactionClient,
    tenantId: string,
    internalReferralId: string,
    testIds: string[],
    panelIds: string[],
  ): Promise<void> {
    if (testIds.length) {
      await tx.internalReferralLabTest.createMany({
        data: testIds.map((labTestId) => ({
          tenantId,
          internalReferralId,
          labTestId,
        })),
      });
    }
    if (panelIds.length) {
      await tx.internalReferralLabPanel.createMany({
        data: panelIds.map((labPanelId) => ({
          tenantId,
          internalReferralId,
          labPanelId,
        })),
      });
    }
  }

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
    if (dto.fullName !== undefined) data.fullName = dto.fullName ?? null;
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
   * Compose the GET-single response: enrich assigned lab tests/panels with their
   * resolved name/code (null when the referenced test/panel was deleted).
   * @param tenantId tenant scope (for resolving lab test/panel names)
   * @param referral the loaded internal referral with relations
   */
  private async toDetail(
    tenantId: string,
    referral: InternalReferralWithRelations,
  ): Promise<InternalReferralDetail> {
    const testIds = [...new Set(referral.labTests.map((t) => t.labTestId))];
    const panelIds = [...new Set(referral.labPanels.map((p) => p.labPanelId))];

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
      ...referral,
      labTests: referral.labTests.map((t) => ({
        ...t,
        testName: testMap.get(t.labTestId)?.testName ?? null,
        testCode: testMap.get(t.labTestId)?.testCode ?? null,
      })),
      labPanels: referral.labPanels.map((p) => ({
        ...p,
        panelName: panelMap.get(p.labPanelId)?.panelName ?? null,
        panelCode: panelMap.get(p.labPanelId)?.panelCode ?? null,
      })),
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
