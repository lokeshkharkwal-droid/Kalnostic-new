import { Injectable } from '@nestjs/common';
import {
  CommissionType,
  FixedCommissionCycle,
  PaymentCycle,
  Prisma,
  ReferralPanel,
  ReferralPaymentMode,
  ReferralType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { ReferralListAssignmentService } from '../referral-list/referral-list-assignment.service';
import { ReferralPanelSettingsService } from '../referral-panel-settings/referral-panel-settings.service';
import { CreateReferralPanelDto } from './dto/create-referral-panel.dto';
import { UpdateReferralPanelDto } from './dto/update-referral-panel.dto';
import { ListReferralPanelsDto } from './dto/list-referral-panels.dto';
import {
  BonusSlab,
  CommissionSlab,
  ReferralPanelEntity,
  ReferralPanelListItem,
} from './entities/referral-panel.entity';
import {
  InvalidCommissionConfigException,
  ReferralPanelCodeConflictException,
  ReferralPanelNameConflictException,
  ReferralPanelNotFoundException,
} from './exceptions/referral-panel.exceptions';

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

/** The normalised commission columns written to the `referral_panels` row. */
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
 * Referral-panel management. Tenant-scoped, tenant-level (CLAUDE.md §4.6): every
 * query carries `tenantId` (defence in depth on top of RLS, §4.3) and filters
 * soft-deleted rows. Contact persons are flat columns on the panel row; commission
 * and incentive slabs are JSON. The assigned Lab Test List / Lab Panel List is a
 * per-branch `ReferralListAssignment` managed via `ReferralListAssignmentService`.
 * The conditional commission/incentive rules are enforced here against the effective
 * (merged, on update) state, and the stored data is normalised so dependent fields
 * are nulled out when they don't apply.
 */
@Injectable()
export class ReferralPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referralPanelSettingsService: ReferralPanelSettingsService,
    private readonly branchService: BranchService,
    private readonly listAssignmentService: ReferralListAssignmentService,
  ) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /referral-panels/options`). Tenant-scoped to active, non-deleted
   * referral panels; optionally filtered by a case-insensitive `name` search.
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
    const where: Prisma.ReferralPanelWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: true,
    };
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { panelCode: { contains: search, mode: 'insensitive' } },
        { directorMobile: { contains: search, mode: 'insensitive' } },
        { accessionPersonMobile: { contains: search, mode: 'insensitive' } },
        { registrationPersonMobile: { contains: search, mode: 'insensitive' } },
        { logisticsPersonMobile: { contains: search, mode: 'insensitive' } },
        { accountsPersonMobile: { contains: search, mode: 'insensitive' } },
      ];
    }

    const select = { id: true, name: true } as const;
    const orderBy = { name: 'asc' } as const;

    if (filters.page === undefined) {
      const rows = await this.prisma.referralPanel.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.name }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.referralPanel.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.referralPanel.count({ where }),
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
   * Create a referral panel. The `code` is system-generated (per-tenant
   * sequential, `RP-00001`…) by atomically incrementing
   * `Tenant.referralPanelCounter`, and is immutable thereafter.
   * Commission/incentive config is validated and normalised. When an active
   * branch is supplied, the chosen per-branch Lab Test / Lab Panel List is
   * attached via `ReferralListAssignmentService`.
   * @param tenantId owning tenant
   * @param branchId active branch from the JWT (null → no list assignment written)
   * @param actorId person id recorded as created-by on the list assignment (or null)
   * @param dto validated payload (no `code`/`tenantId` — set here / from context)
   * @param options.legacyId source EzHealthTrack referring_panels.id, stored for
   *   idempotent data migration + traceability (migration tooling only; never
   *   client-supplied)
   * @returns the created panel, with the resolved list assignment (enriched)
   * @throws InvalidCommissionConfigException on a commission/incentive invariant
   * @throws ReferralPanelNameConflictException / ReferralPanelCodeConflictException
   */
  async create(
    tenantId: string,
    branchId: string | null,
    actorId: string | null,
    dto: CreateReferralPanelDto,
    options?: { legacyId?: number | null },
  ): Promise<ReferralPanelEntity> {
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

    let createdId: string;
    try {
      createdId = await this.prisma.withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { referralPanelCounter: { increment: 1 } },
          select: { referralPanelCounter: true },
        });
        const code = `RP-${String(tenant.referralPanelCounter).padStart(5, '0')}`;

        const data: Prisma.ReferralPanelUncheckedCreateInput = {
          tenantId,
          branchId: dto.branchId ?? null,
          code,
          name: dto.name,
          shortName: dto.shortName ?? null,
          panelCode: dto.panelCode ?? null,
          clientType: dto.clientType,
          referralPanelSettingsId: dto.referralPanelSettingsId ?? null,
          isActive: dto.isActive ?? true,
          // Address
          addressLine1: dto.addressLine1 ?? null,
          addressLine2: dto.addressLine2 ?? null,
          country: dto.country ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          pincode: dto.pincode ?? null,
          gstNumber: dto.gstNumber ?? null,
          panNumber: dto.panNumber ?? null,
          // Bank
          accountHolderName: dto.accountHolderName ?? null,
          bankName: dto.bankName ?? null,
          accountNumber: dto.accountNumber ?? null,
          ifscCode: dto.ifscCode ?? null,
          // Contacts
          directorName: dto.directorName ?? null,
          directorMobile: dto.directorMobile ?? null,
          directorEmail: dto.directorEmail ?? null,
          accessionPersonName: dto.accessionPersonName ?? null,
          accessionPersonMobile: dto.accessionPersonMobile ?? null,
          accessionPersonEmail: dto.accessionPersonEmail ?? null,
          registrationPersonName: dto.registrationPersonName ?? null,
          registrationPersonMobile: dto.registrationPersonMobile ?? null,
          registrationPersonEmail: dto.registrationPersonEmail ?? null,
          logisticsPersonName: dto.logisticsPersonName ?? null,
          logisticsPersonMobile: dto.logisticsPersonMobile ?? null,
          logisticsPersonEmail: dto.logisticsPersonEmail ?? null,
          accountsPersonName: dto.accountsPersonName ?? null,
          accountsPersonMobile: dto.accountsPersonMobile ?? null,
          accountsPersonEmail: dto.accountsPersonEmail ?? null,
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
          legacyId: options?.legacyId ?? null,
        };

        const panel = await tx.referralPanel.create({ data });
        return panel.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.name, dto.panelCode);
      throw e;
    }
    if (branchId) {
      await this.listAssignmentService.upsert(
        tenantId,
        branchId,
        actorId,
        ReferralType.PANEL,
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
   * Fetch one active referral panel scoped to its tenant. When a branch context is
   * supplied, the active branch's Lab Test / Lab Panel List assignment is prefilled
   * onto the returned object (both null when no branch is given or none is assigned).
   * @param id panel id
   * @param tenantId tenant scope
   * @param branchId active branch (from JWT); when set, the list assignment is loaded
   * @throws ReferralPanelNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ): Promise<ReferralPanelEntity> {
    const panel = await this.prisma.referralPanel.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!panel) {
      throw new ReferralPanelNotFoundException(id);
    }

    const assignment = branchId
      ? await this.listAssignmentService.getAssignment(
          tenantId,
          branchId,
          ReferralType.PANEL,
          id,
        )
      : null;

    return {
      ...panel,
      branchLabTestListId: assignment?.branchLabTestListId ?? null,
      branchLabPanelListId: assignment?.branchLabPanelListId ?? null,
    };
  }

  /**
   * List active referral panels for a tenant (offset pagination). `search` matches
   * the panel `name` or the user-supplied `panelCode` (case-insensitive);
   * `clientType` filters by billing relationship; `status` (ACTIVE/INACTIVE) maps
   * to `isActive`; `branchId` restricts to panels scoped to that branch.
   * @param tenantId tenant scope
   * @param query pagination + optional `search` (panel name / panel code),
   *   `clientType`, `status`, and `branchId` filters
   */
  async findAll(
    tenantId: string,
    query: ListReferralPanelsDto,
  ): Promise<PaginatedResult<ReferralPanelListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ReferralPanelWhereInput = { tenantId, deletedAt: null };
    if (query.search) {
      const search = query.search.trim();
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { panelCode: { contains: search, mode: 'insensitive' } },
        ];
      }
    }
    if (query.clientType) {
      where.clientType = query.clientType;
    }
    if (query.status) {
      where.isActive = query.status === 'ACTIVE';
    }
    if (query.branchId) {
      where.branchId = query.branchId;
    }
    const [rows, total] = await Promise.all([
      this.prisma.referralPanel.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.referralPanel.count({ where }),
    ]);
    const data: ReferralPanelListItem[] = rows;
    return { data, total, page, limit };
  }

  /**
   * Update a referral panel. `code` is immutable. Commission/incentive config is
   * re-validated and normalised against the merged (existing + patch) state when
   * any related field is present. When an active branch is supplied and either
   * `branchLabTestListId`/`branchLabPanelListId` is present on the patch, the
   * per-branch Lab Test / Lab Panel List assignment is re-applied.
   * @param id panel id
   * @param tenantId tenant scope
   * @param branchId active branch from the JWT (null → no list assignment written)
   * @param actorId person id recorded as updated-by on the list assignment (or null)
   * @param dto partial update
   * @throws ReferralPanelNotFoundException if missing/soft-deleted
   * @throws InvalidCommissionConfigException / ReferralPanelNameConflictException /
   *   ReferralPanelCodeConflictException
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string | null,
    dto: UpdateReferralPanelDto,
  ): Promise<ReferralPanelEntity> {
    const existing = await this.findById(id, tenantId);

    const commissionTouched =
      dto.isCommissionApplicable !== undefined ||
      dto.commissionType !== undefined ||
      dto.commissionPctLabTest !== undefined ||
      dto.commissionPctLabPanel !== undefined ||
      dto.commissionSlabs !== undefined ||
      dto.fixedCommissionCycle !== undefined ||
      dto.fixedAmount !== undefined;
    const bonusTouched =
      dto.isIncentiveBonusApplicable !== undefined ||
      dto.bonusSlabs !== undefined;

    await this.assertSettingsRef(tenantId, dto.referralPanelSettingsId);
    await this.assertBranchRef(tenantId, dto.branchId);

    let data: Prisma.ReferralPanelUpdateInput = this.toScalarUpdateData(dto);

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

    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.referralPanel.update({ where: { id }, data });
      });
    } catch (e) {
      this.rethrowConflict(e, dto.name ?? existing.name, dto.panelCode);
      throw e;
    }

    if (
      branchId &&
      (dto.branchLabTestListId !== undefined ||
        dto.branchLabPanelListId !== undefined)
    ) {
      await this.listAssignmentService.upsert(
        tenantId,
        branchId,
        actorId,
        ReferralType.PANEL,
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
   * Soft-delete a referral panel. The per-branch list assignment is left as-is (it
   * resolves against the referral only while the referral is active).
   * @param id panel id
   * @param tenantId tenant scope
   * @throws ReferralPanelNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<ReferralPanel> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      return tx.referralPanel.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  }

  /**
   * Validate the commission configuration's cross-field invariants: a required
   * type when commission applies, non-empty slabs for SLAB_BASED, a cycle (and a
   * fixed amount for non–ORDER_WISE cycles) for FIXED_AMOUNT, and well-ordered slab
   * bands.
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
   * Build the scalar update payload (basic/address/bank/contact/payment/attachment
   * fields) from an update DTO. Only fields present on the DTO are written; `code`
   * is immutable and commission/incentive/lab-list fields are handled separately.
   * @param dto the update DTO
   */
  private toScalarUpdateData(
    dto: UpdateReferralPanelDto,
  ): Prisma.ReferralPanelUpdateInput {
    const data: Prisma.ReferralPanelUpdateInput = {};
    // Basic
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.shortName !== undefined) data.shortName = dto.shortName ?? null;
    if (dto.panelCode !== undefined) data.panelCode = dto.panelCode ?? null;
    if (dto.clientType !== undefined) data.clientType = dto.clientType;
    if (dto.branchId !== undefined) data.branchId = dto.branchId ?? null;
    if (dto.referralPanelSettingsId !== undefined) {
      data.referralPanelSettings = dto.referralPanelSettingsId
        ? { connect: { id: dto.referralPanelSettingsId } }
        : { disconnect: true };
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    // Address
    if (dto.addressLine1 !== undefined)
      data.addressLine1 = dto.addressLine1 ?? null;
    if (dto.addressLine2 !== undefined)
      data.addressLine2 = dto.addressLine2 ?? null;
    if (dto.country !== undefined) data.country = dto.country ?? null;
    if (dto.city !== undefined) data.city = dto.city ?? null;
    if (dto.state !== undefined) data.state = dto.state ?? null;
    if (dto.pincode !== undefined) data.pincode = dto.pincode ?? null;
    if (dto.gstNumber !== undefined) data.gstNumber = dto.gstNumber ?? null;
    if (dto.panNumber !== undefined) data.panNumber = dto.panNumber ?? null;
    // Bank
    if (dto.accountHolderName !== undefined)
      data.accountHolderName = dto.accountHolderName ?? null;
    if (dto.bankName !== undefined) data.bankName = dto.bankName ?? null;
    if (dto.accountNumber !== undefined)
      data.accountNumber = dto.accountNumber ?? null;
    if (dto.ifscCode !== undefined) data.ifscCode = dto.ifscCode ?? null;
    // Contacts
    if (dto.directorName !== undefined)
      data.directorName = dto.directorName ?? null;
    if (dto.directorMobile !== undefined)
      data.directorMobile = dto.directorMobile ?? null;
    if (dto.directorEmail !== undefined)
      data.directorEmail = dto.directorEmail ?? null;
    if (dto.accessionPersonName !== undefined)
      data.accessionPersonName = dto.accessionPersonName ?? null;
    if (dto.accessionPersonMobile !== undefined)
      data.accessionPersonMobile = dto.accessionPersonMobile ?? null;
    if (dto.accessionPersonEmail !== undefined)
      data.accessionPersonEmail = dto.accessionPersonEmail ?? null;
    if (dto.registrationPersonName !== undefined)
      data.registrationPersonName = dto.registrationPersonName ?? null;
    if (dto.registrationPersonMobile !== undefined)
      data.registrationPersonMobile = dto.registrationPersonMobile ?? null;
    if (dto.registrationPersonEmail !== undefined)
      data.registrationPersonEmail = dto.registrationPersonEmail ?? null;
    if (dto.logisticsPersonName !== undefined)
      data.logisticsPersonName = dto.logisticsPersonName ?? null;
    if (dto.logisticsPersonMobile !== undefined)
      data.logisticsPersonMobile = dto.logisticsPersonMobile ?? null;
    if (dto.logisticsPersonEmail !== undefined)
      data.logisticsPersonEmail = dto.logisticsPersonEmail ?? null;
    if (dto.accountsPersonName !== undefined)
      data.accountsPersonName = dto.accountsPersonName ?? null;
    if (dto.accountsPersonMobile !== undefined)
      data.accountsPersonMobile = dto.accountsPersonMobile ?? null;
    if (dto.accountsPersonEmail !== undefined)
      data.accountsPersonEmail = dto.accountsPersonEmail ?? null;
    // TDS & payment & attachment
    if (dto.isTdsApplicable !== undefined)
      data.isTdsApplicable = dto.isTdsApplicable;
    if (dto.paymentCycle !== undefined) data.paymentCycle = dto.paymentCycle;
    if (dto.paymentMode !== undefined) data.paymentMode = dto.paymentMode;
    if (dto.monthlyTargetAmount !== undefined)
      data.monthlyTargetAmount = dto.monthlyTargetAmount;
    if (dto.fileName !== undefined) data.fileName = dto.fileName ?? null;
    if (dto.fileUrl !== undefined) data.fileUrl = dto.fileUrl ?? null;
    if (dto.remarks !== undefined) data.remarks = dto.remarks ?? null;
    return data;
  }

  /**
   * Coerce a nullable Prisma Decimal column to a plain number (or null) for
   * merging into the effective commission state.
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

  /**
   * Map a caught error to the right 409 when it is a unique-constraint violation
   * (P2002): the user-supplied `panel_code` index → code conflict, otherwise the
   * name index → name conflict. Returns silently for any other error so the caller
   * can rethrow it unchanged.
   * @param e the caught error
   * @param name the panel name (for the name-conflict message)
   * @param panelCode the panel code, if supplied (for the code-conflict message)
   */
  private rethrowConflict(e: unknown, name: string, panelCode?: string): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const rawTarget: unknown = e.meta?.target;
      let targetStr = '';
      if (Array.isArray(rawTarget)) {
        targetStr = (rawTarget as unknown[])
          .map((x) => (typeof x === 'string' ? x : ''))
          .join(',');
      } else if (typeof rawTarget === 'string') {
        targetStr = rawTarget;
      }
      if (targetStr.includes('panel_code') && panelCode) {
        throw new ReferralPanelCodeConflictException(panelCode);
      }
      throw new ReferralPanelNameConflictException(name);
    }
  }
}
