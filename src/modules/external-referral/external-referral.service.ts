import { Injectable } from '@nestjs/common';
import {
  CommissionType,
  ExternalReferralStatus,
  FixedCommissionCycle,
  PaymentCycle,
  Prisma,
  ReferralPaymentMode,
  ReferralType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { ReferralListAssignmentService } from '../referral-list/referral-list-assignment.service';
import { ReferralPanelSettingsService } from '../referral-panel-settings/referral-panel-settings.service';
import { CreateExternalReferralDto } from './dto/create-external-referral.dto';
import { UpdateExternalReferralDto } from './dto/update-external-referral.dto';
import { ListExternalReferralsDto } from './dto/list-external-referrals.dto';
import {
  BonusSlab,
  CommissionSlab,
  EXTERNAL_REFERRAL_LIST_SELECT,
  ExternalReferralDetail,
  ExternalReferralListItem,
} from './entities/external-referral.entity';
import {
  ExternalReferralNotFoundException,
  InvalidCommissionConfigException,
} from './exceptions/external-referral.exceptions';

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

/** The normalised commission columns written to the `external_referrals` row. */
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
 * External-referral registry management. Tenant-scoped, tenant-level (CLAUDE.md
 * §4.6): the registry of external referral partners belongs to the business as a
 * whole, not a branch. Every query carries `tenantId` (defence in depth on top of
 * RLS, §4.3) and filters soft-deleted rows. The assigned Lab Test / Lab Panel List
 * is a per-branch `ReferralListAssignment` managed via
 * `ReferralListAssignmentService`. Commission/incentive config is validated against
 * the effective (merged, on update) state and the stored data is normalised so
 * dependent fields are nulled out when they don't apply.
 */
@Injectable()
export class ExternalReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referralPanelSettingsService: ReferralPanelSettingsService,
    private readonly branchService: BranchService,
    private readonly listAssignmentService: ReferralListAssignmentService,
  ) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /external-referrals/options`). Tenant-scoped to non-deleted external
   * referrals; optionally filtered by a case-insensitive `name` search. Returns
   * the full array when `page` is omitted, or a paginated envelope when `page`
   * is supplied.
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
    const where: Prisma.ExternalReferralWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { organisationName: { contains: search, mode: 'insensitive' } },
        { mobileNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const select = { id: true, name: true } as const;
    const orderBy = { name: 'asc' } as const;

    if (filters.page === undefined) {
      const rows = await this.prisma.externalReferral.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.name }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.externalReferral.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.externalReferral.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: r.name })),
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
   * Register an external referral in one transaction. Commission/incentive config is
   * validated and normalised. When an active branch is supplied, the chosen
   * per-branch Lab Test / Lab Panel List is attached via
   * `ReferralListAssignmentService`.
   * @param tenantId owning tenant (from the JWT, never the body)
   * @param branchId active branch from the JWT (null → no list assignment written)
   * @param actorId person id recorded as created-by on the list assignment (or null)
   * @param dto validated payload
   * @returns the created external referral with the resolved list assignment
   * @throws InvalidCommissionConfigException on a commission/incentive invariant
   */
  async create(
    tenantId: string,
    branchId: string | null,
    actorId: string | null,
    dto: CreateExternalReferralDto,
  ): Promise<ExternalReferralDetail> {
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

    await this.assertSettingsRef(tenantId, dto.referralPanelSettingsId);
    await this.assertBranchRef(tenantId, dto.branchId);

    const data: Prisma.ExternalReferralUncheckedCreateInput = {
      tenantId,
      branchId: dto.branchId ?? null,
      referralPanelSettingsId: dto.referralPanelSettingsId ?? null,
      // Basic details
      name: dto.name,
      organisationName: dto.organisationName ?? null,
      referralCode: dto.referralCode ?? null,
      status: dto.status ?? ExternalReferralStatus.ACTIVE,
      mobileNumber: dto.mobileNumber ?? null,
      email: dto.email ?? null,
      // Address & identity
      address: dto.address ?? null,
      country: dto.country ?? null,
      city: dto.city ?? null,
      state: dto.state ?? null,
      pinCode: dto.pinCode ?? null,
      panNumber: dto.panNumber ?? null,
      aadhaarNumber: dto.aadhaarNumber ?? null,
      gstNumber: dto.gstNumber ?? null,
      // Bank details
      accountHolderName: dto.accountHolderName ?? null,
      bankName: dto.bankName ?? null,
      accountNumber: dto.accountNumber ?? null,
      ifscCode: dto.ifscCode ?? null,
      // Commission (normalised)
      ...this.normalizeCommission(commissionEff),
      isTdsApplicable: dto.isTdsApplicable ?? false,
      tds: dto.isTdsApplicable ? (dto.tds ?? null) : null,
      // Payment & incentive
      paymentCycle: dto.paymentCycle ?? PaymentCycle.NA,
      paymentMode: dto.paymentMode ?? ReferralPaymentMode.BANK_TRANSFER,
      monthlyTargetAmount: dto.monthlyTargetAmount ?? 0,
      isIncentiveBonusApplicable: incentive,
      bonusSlabs: incentive ? bonusSlabs : [],
      // Attachment & remarks
      fileName: dto.fileName ?? null,
      fileUrl: dto.fileUrl ?? null,
      remarks: dto.remarks ?? null,
    };

    const createdId = await this.prisma.withTenant(tenantId, async (tx) => {
      const referral = await tx.externalReferral.create({ data });
      return referral.id;
    });
    if (branchId) {
      await this.listAssignmentService.upsert(
        tenantId,
        branchId,
        actorId,
        ReferralType.EXTERNAL,
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
   * List active external referrals for a tenant (offset pagination), returning the
   * trimmed listing projection. Supports a free-text `search` by referral name
   * (whitespace-tokenised, with organisation name / mobile number / referral code as
   * fallbacks), a `status` filter, and a `branchId` filter.
   * Each row is enriched with the active branch's assigned Lab Test List / Lab
   * Panel List (bulk-resolved in a fixed number of extra queries, never per-row).
   * @param tenantId tenant scope
   * @param activeBranchId caller's active branch (from JWT); used to resolve the
   *   Lab Test/Panel List assignment, distinct from the `branchId` query filter
   * @param query pagination + filters
   */
  async findAllForTenant(
    tenantId: string,
    activeBranchId: string | null,
    query: ListExternalReferralsDto,
  ): Promise<PaginatedResult<ExternalReferralListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ExternalReferralWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;
    if (query.branchId) where.branchId = query.branchId;
    const term = query.search?.trim();
    if (term) {
      // Search by name: split into whitespace tokens and require EACH to match the
      // name (with organisation name / mobile number / referral code as fallbacks),
      // so "Acme Labs" matches a referral whose name contains both tokens.
      where.AND = term.split(/\s+/).map((token) => ({
        OR: [
          { name: { contains: token, mode: 'insensitive' } },
          { organisationName: { contains: token, mode: 'insensitive' } },
          { mobileNumber: { contains: token, mode: 'insensitive' } },
          { referralCode: { contains: token, mode: 'insensitive' } },
        ],
      }));
    }

    const [rows, total] = await Promise.all([
      this.prisma.externalReferral.findMany({
        where,
        select: EXTERNAL_REFERRAL_LIST_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.externalReferral.count({ where }),
    ]);
    const assignments =
      await this.listAssignmentService.getAssignmentsWithListNames(
        tenantId,
        activeBranchId,
        ReferralType.EXTERNAL,
        rows.map((r) => r.id),
      );
    const data: ExternalReferralListItem[] = rows.map((r) => ({
      ...r,
      labTestList: assignments.get(r.id)?.labTestList ?? null,
      labPanelList: assignments.get(r.id)?.labPanelList ?? null,
    }));
    return { data, total, page, limit };
  }

  /**
   * Fetch one active external referral scoped to its tenant. When a branch context
   * is supplied, the active branch's Lab Test / Lab Panel List assignment is
   * prefilled onto the result (both null when no branch context or no assignment).
   * @param id external referral id
   * @param tenantId tenant scope
   * @param branchId active branch (from JWT); when set, the list assignment is loaded
   * @throws ExternalReferralNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ): Promise<ExternalReferralDetail> {
    const referral = await this.prisma.externalReferral.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!referral) {
      throw new ExternalReferralNotFoundException(id);
    }
    return this.toDetail(tenantId, branchId ?? null, referral);
  }

  /**
   * Update an external referral. Only supplied fields change. Commission/incentive
   * config is re-validated and normalised against the merged (existing + patch) state
   * when any related field is present. When an active branch is supplied and either
   * `branchLabTestListId`/`branchLabPanelListId` is present, the per-branch Lab Test
   * / Lab Panel List assignment is re-applied. All in one transaction.
   * @param id external referral id
   * @param tenantId tenant scope
   * @param branchId active branch from the JWT (null → no list assignment written)
   * @param actorId person id recorded as updated-by on the list assignment (or null)
   * @param dto partial update
   * @throws ExternalReferralNotFoundException if missing/soft-deleted
   * @throws InvalidCommissionConfigException
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string | null,
    dto: UpdateExternalReferralDto,
  ): Promise<ExternalReferralDetail> {
    const existing = await this.findById(id, tenantId);

    await this.assertSettingsRef(tenantId, dto.referralPanelSettingsId);
    await this.assertBranchRef(tenantId, dto.branchId);

    let data: Prisma.ExternalReferralUpdateInput = this.toScalarUpdateData(dto);

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
      await tx.externalReferral.update({ where: { id }, data });
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
        ReferralType.EXTERNAL,
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
   * Soft-delete an external referral. The per-branch list assignment is left as-is
   * (it resolves against the referral only while the referral is active).
   * @param id external referral id
   * @param tenantId tenant scope
   * @throws ExternalReferralNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<ExternalReferralDetail> {
    await this.findById(id, tenantId);
    const now = new Date();
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.externalReferral.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
    // Re-fetch ignoring the soft-delete filter so the caller gets the final state.
    const removed = await this.prisma.externalReferral.findUnique({
      where: { id },
    });
    // `removed` is guaranteed present (we just updated it); narrow for the type.
    return this.toDetail(tenantId, null, removed as ExternalReferralDetail);
  }

  // ── Validation helpers ──────────────────────────────────────────────────────

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

  /**
   * Build the scalar update payload (basic/address/bank/payment/attachment/status
   * fields) from an update DTO. Only fields present on the DTO are written;
   * commission/incentive and lab-list fields are handled separately.
   * @param dto the update DTO
   */
  private toScalarUpdateData(
    dto: UpdateExternalReferralDto,
  ): Prisma.ExternalReferralUpdateInput {
    const data: Prisma.ExternalReferralUpdateInput = {};
    // Basic details
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.organisationName !== undefined) {
      data.organisationName = dto.organisationName ?? null;
    }
    if (dto.referralCode !== undefined) {
      data.referralCode = dto.referralCode ?? null;
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.mobileNumber !== undefined) {
      data.mobileNumber = dto.mobileNumber ?? null;
    }
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.branchId !== undefined) data.branchId = dto.branchId ?? null;
    // Address & identity
    if (dto.address !== undefined) data.address = dto.address ?? null;
    if (dto.country !== undefined) data.country = dto.country ?? null;
    if (dto.city !== undefined) data.city = dto.city ?? null;
    if (dto.state !== undefined) data.state = dto.state ?? null;
    if (dto.pinCode !== undefined) data.pinCode = dto.pinCode ?? null;
    if (dto.panNumber !== undefined) data.panNumber = dto.panNumber ?? null;
    if (dto.aadhaarNumber !== undefined) {
      data.aadhaarNumber = dto.aadhaarNumber ?? null;
    }
    if (dto.gstNumber !== undefined) data.gstNumber = dto.gstNumber ?? null;
    // Bank details
    if (dto.accountHolderName !== undefined) {
      data.accountHolderName = dto.accountHolderName ?? null;
    }
    if (dto.bankName !== undefined) data.bankName = dto.bankName ?? null;
    if (dto.accountNumber !== undefined) {
      data.accountNumber = dto.accountNumber ?? null;
    }
    if (dto.ifscCode !== undefined) data.ifscCode = dto.ifscCode ?? null;
    // Settings template ref
    if (dto.referralPanelSettingsId !== undefined) {
      data.referralPanelSettings = dto.referralPanelSettingsId
        ? { connect: { id: dto.referralPanelSettingsId } }
        : { disconnect: true };
    }
    // TDS & payment
    if (dto.isTdsApplicable !== undefined) {
      data.isTdsApplicable = dto.isTdsApplicable;
    }
    if (dto.paymentCycle !== undefined) data.paymentCycle = dto.paymentCycle;
    if (dto.paymentMode !== undefined) data.paymentMode = dto.paymentMode;
    if (dto.monthlyTargetAmount !== undefined) {
      data.monthlyTargetAmount = dto.monthlyTargetAmount;
    }
    // Attachment & remarks
    if (dto.fileName !== undefined) data.fileName = dto.fileName ?? null;
    if (dto.fileUrl !== undefined) data.fileUrl = dto.fileUrl ?? null;
    if (dto.remarks !== undefined) data.remarks = dto.remarks ?? null;
    return data;
  }

  // ── Response shaping ────────────────────────────────────────────────────────

  /**
   * Compose the GET-single response: attach the active branch's Lab Test / Lab Panel
   * List assignment (both null when there is no branch context or no assignment).
   * @param tenantId tenant scope
   * @param branchId active branch (from JWT) or null
   * @param referral the loaded external referral row
   */
  private async toDetail(
    tenantId: string,
    branchId: string | null,
    referral: ExternalReferralDetail,
  ): Promise<ExternalReferralDetail> {
    const assignment = branchId
      ? await this.listAssignmentService.getAssignment(
          tenantId,
          branchId,
          ReferralType.EXTERNAL,
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
