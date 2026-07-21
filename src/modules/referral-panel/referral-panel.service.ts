import { Injectable } from '@nestjs/common';
import {
  CommissionType,
  FixedCommissionCycle,
  PaymentCycle,
  Prisma,
  ReferralPanel,
  ReferralPaymentMode,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { ReferralPanelSettingsService } from '../referral-panel-settings/referral-panel-settings.service';
import { CreateReferralPanelDto } from './dto/create-referral-panel.dto';
import { UpdateReferralPanelDto } from './dto/update-referral-panel.dto';
import { ListReferralPanelsDto } from './dto/list-referral-panels.dto';
import {
  BonusSlab,
  CommissionSlab,
  LabRef,
  ReferralPanelEntity,
  ReferralPanelListItem,
} from './entities/referral-panel.entity';
import {
  InvalidCommissionConfigException,
  InvalidLabPanelRefException,
  InvalidLabTestRefException,
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

/** Assigned lab test/panel references for one referral panel. */
interface LabLists {
  labTestList: LabRef[];
  labPanelList: LabRef[];
}

/**
 * Referral-panel management. Tenant-scoped, tenant-level (CLAUDE.md §4.6): every
 * query carries `tenantId` (defence in depth on top of RLS, §4.3) and filters
 * soft-deleted rows. Contact persons are flat columns on the panel row; commission
 * and incentive slabs are JSON; assigned lab tests/panels are child rows
 * (`ReferralPanelLabTest` / `ReferralPanelLabPanel`, replace-all on update). The
 * conditional commission/incentive rules are enforced here against the effective
 * (merged, on update) state, and the stored data is normalised so dependent fields
 * are nulled out when they don't apply.
 */
@Injectable()
export class ReferralPanelService {
  /** Nested include used everywhere a full panel is returned. */
  private static readonly FULL_INCLUDE = {
    labTests: { where: { deletedAt: null } },
    labPanels: { where: { deletedAt: null } },
  } satisfies Prisma.ReferralPanelInclude;

  constructor(
    private readonly prisma: PrismaService,
    private readonly referralPanelSettingsService: ReferralPanelSettingsService,
    private readonly branchService: BranchService,
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
   * Create a referral panel with its assigned lab tests/panels in one transaction.
   * The `code` is system-generated (per-tenant sequential, `RP-00001`…) by
   * atomically incrementing `Tenant.referralPanelCounter`, and is immutable
   * thereafter. Commission/incentive config is validated and normalised; assigned
   * `labTestId`/`labPanelId`s are validated to be active items in the tenant.
   * @param tenantId owning tenant
   * @param dto validated payload (no `code`/`tenantId` — set here / from context)
   * @returns the created panel with its active assigned tests/panels (enriched)
   * @throws InvalidCommissionConfigException on a commission/incentive invariant
   * @throws InvalidLabTestRefException / InvalidLabPanelRefException on a bad ref
   * @throws ReferralPanelNameConflictException / ReferralPanelCodeConflictException
   */
  async create(
    tenantId: string,
    dto: CreateReferralPanelDto,
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

    const testIds = dto.labTestIds ?? [];
    const panelIds = dto.labPanelIds ?? [];
    await this.assertLabRefs(tenantId, testIds, panelIds);
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
        };

        const panel = await tx.referralPanel.create({ data });
        await this.writeLabRefs(tx, tenantId, panel.id, testIds, panelIds);
        return panel.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.name, dto.panelCode);
      throw e;
    }
    return this.findById(createdId, tenantId);
  }

  /**
   * Fetch one active referral panel scoped to its tenant, with its assigned lab
   * tests and lab panels. Each assigned item is enriched inline with the lab
   * test/panel name and code (resolved by id; left `null` if the referenced item
   * has since been deleted).
   * @param id panel id
   * @param tenantId tenant scope
   * @throws ReferralPanelNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<ReferralPanelEntity> {
    const panel = await this.prisma.referralPanel.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: ReferralPanelService.FULL_INCLUDE,
    });
    if (!panel) {
      throw new ReferralPanelNotFoundException(id);
    }

    const labTests = panel.labTests ?? [];
    const labPanels = panel.labPanels ?? [];
    const testIds = [...new Set(labTests.map((t) => t.labTestId))];
    const panelIds = [...new Set(labPanels.map((p) => p.labPanelId))];

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
      ...panel,
      labTests: labTests.map((t) => ({
        ...t,
        testName: testMap.get(t.labTestId)?.testName ?? null,
        testCode: testMap.get(t.labTestId)?.testCode ?? null,
      })),
      labPanels: labPanels.map((p) => ({
        ...p,
        panelName: panelMap.get(p.labPanelId)?.panelName ?? null,
        panelCode: panelMap.get(p.labPanelId)?.panelCode ?? null,
      })),
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
    const labLists = await this.resolveLabLists(
      tenantId,
      rows.map((r) => r.id),
    );
    const data: ReferralPanelListItem[] = rows.map((r) => ({
      ...r,
      ...(labLists.get(r.id) ?? { labTestList: [], labPanelList: [] }),
    }));
    return { data, total, page, limit };
  }

  /**
   * Resolve the assigned lab test/panel references for a page of referral panels,
   * keyed by panel id, each shaped as `[{ id, name }]`. Uses a bounded number of
   * queries regardless of page size: one per join table plus one per lab model
   * (no N+1). Names of since-deleted lab tests/panels are omitted.
   * @param tenantId tenant scope
   * @param panelIds the panel ids on the current page
   */
  private async resolveLabLists(
    tenantId: string,
    panelIds: string[],
  ): Promise<Map<string, LabLists>> {
    const result = new Map<string, LabLists>();
    for (const id of panelIds) {
      result.set(id, { labTestList: [], labPanelList: [] });
    }
    if (panelIds.length === 0) {
      return result;
    }

    const [testLinks, panelLinks] = await Promise.all([
      this.prisma.referralPanelLabTest.findMany({
        where: { referralPanelId: { in: panelIds }, tenantId, deletedAt: null },
        select: { referralPanelId: true, labTestId: true },
      }),
      this.prisma.referralPanelLabPanel.findMany({
        where: { referralPanelId: { in: panelIds }, tenantId, deletedAt: null },
        select: { referralPanelId: true, labPanelId: true },
      }),
    ]);

    const testIds = [...new Set(testLinks.map((l) => l.labTestId))];
    const labPanelIds = [...new Set(panelLinks.map((l) => l.labPanelId))];
    const [tests, panels] = await Promise.all([
      testIds.length
        ? this.prisma.labTest.findMany({
            where: { tenantId, id: { in: testIds } },
            select: { id: true, testName: true },
          })
        : Promise.resolve([]),
      labPanelIds.length
        ? this.prisma.labPanel.findMany({
            where: { tenantId, id: { in: labPanelIds } },
            select: { id: true, panelName: true },
          })
        : Promise.resolve([]),
    ]);
    const testName = new Map(tests.map((t) => [t.id, t.testName]));
    const panelName = new Map(panels.map((p) => [p.id, p.panelName]));

    for (const link of testLinks) {
      const name = testName.get(link.labTestId);
      const entry = result.get(link.referralPanelId);
      if (name !== undefined && entry) {
        entry.labTestList.push({ id: link.labTestId, name });
      }
    }
    for (const link of panelLinks) {
      const name = panelName.get(link.labPanelId);
      const entry = result.get(link.referralPanelId);
      if (name !== undefined && entry) {
        entry.labPanelList.push({ id: link.labPanelId, name });
      }
    }
    return result;
  }

  /**
   * Update a referral panel. `code` is immutable. Commission/incentive config is
   * re-validated and normalised against the merged (existing + patch) state when
   * any related field is present. `labTestIds`/`labPanelIds` are replace-all when
   * present (soft-delete the active set, then recreate) and left untouched when
   * absent.
   * @param id panel id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws ReferralPanelNotFoundException if missing/soft-deleted
   * @throws InvalidCommissionConfigException / InvalidLabTestRefException /
   *   InvalidLabPanelRefException / ReferralPanelNameConflictException /
   *   ReferralPanelCodeConflictException
   */
  async update(
    id: string,
    tenantId: string,
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

    const testIds = dto.labTestIds;
    const panelIds = dto.labPanelIds;
    if (testIds !== undefined || panelIds !== undefined) {
      await this.assertLabRefs(tenantId, testIds ?? [], panelIds ?? []);
    }
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

    const now = new Date();
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.referralPanel.update({ where: { id }, data });

        if (testIds !== undefined) {
          await tx.referralPanelLabTest.updateMany({
            where: { referralPanelId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          if (testIds.length) {
            await tx.referralPanelLabTest.createMany({
              data: testIds.map((labTestId) => ({
                tenantId,
                referralPanelId: id,
                labTestId,
              })),
            });
          }
        }

        if (panelIds !== undefined) {
          await tx.referralPanelLabPanel.updateMany({
            where: { referralPanelId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          if (panelIds.length) {
            await tx.referralPanelLabPanel.createMany({
              data: panelIds.map((labPanelId) => ({
                tenantId,
                referralPanelId: id,
                labPanelId,
              })),
            });
          }
        }
      });
    } catch (e) {
      this.rethrowConflict(e, dto.name ?? existing.name, dto.panelCode);
      throw e;
    }
    return this.findById(id, tenantId);
  }

  /**
   * Soft-delete a referral panel and cascade soft-delete its active assigned lab
   * tests and lab panels in one transaction.
   * @param id panel id
   * @param tenantId tenant scope
   * @throws ReferralPanelNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<ReferralPanel> {
    await this.findById(id, tenantId);
    const now = new Date();
    const scope = { referralPanelId: id, tenantId, deletedAt: null };
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.referralPanelLabTest.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
      await tx.referralPanelLabPanel.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
      return tx.referralPanel.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
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
   * Persist a panel's assigned lab tests and lab panels. Assumes the ids were
   * already validated by `assertLabRefs`.
   * @param tx active transaction client
   * @param tenantId tenant scope
   * @param referralPanelId owning panel
   * @param testIds assigned lab-test ids
   * @param panelIds assigned lab-panel ids
   */
  private async writeLabRefs(
    tx: Prisma.TransactionClient,
    tenantId: string,
    referralPanelId: string,
    testIds: string[],
    panelIds: string[],
  ): Promise<void> {
    if (testIds.length) {
      await tx.referralPanelLabTest.createMany({
        data: testIds.map((labTestId) => ({
          tenantId,
          referralPanelId,
          labTestId,
        })),
      });
    }
    if (panelIds.length) {
      await tx.referralPanelLabPanel.createMany({
        data: panelIds.map((labPanelId) => ({
          tenantId,
          referralPanelId,
          labPanelId,
        })),
      });
    }
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
