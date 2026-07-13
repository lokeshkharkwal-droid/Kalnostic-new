import { Injectable } from '@nestjs/common';
import {
  CommissionType,
  FixedCommissionCycle,
  PaymentCycle,
  Prisma,
  ReferralDoctorStatus,
  ReferralPaymentMode,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { CategoryService } from '../category/category.service';
import { DepartmentService } from '../department/department.service';
import { SubCategoryService } from '../sub-category/sub-category.service';
import { ReferralPanelSettingsService } from '../referral-panel-settings/referral-panel-settings.service';
import { CreateReferralDoctorDto } from './dto/create-referral-doctor.dto';
import { UpdateReferralDoctorDto } from './dto/update-referral-doctor.dto';
import { ListReferralDoctorsDto } from './dto/list-referral-doctors.dto';
import { ReferralDoctorQualificationDto } from './dto/referral-doctor-qualification.dto';
import { ReferralDoctorExperienceDto } from './dto/referral-doctor-experience.dto';
import {
  BonusSlab,
  ClassificationRef,
  CommissionSlab,
  REFERRAL_DOCTOR_DETAIL_INCLUDE,
  REFERRAL_DOCTOR_LIST_SELECT,
  ReferralDoctorDetail,
  ReferralDoctorListItem,
  ReferralDoctorListRow,
  ReferralDoctorWithRelations,
} from './entities/referral-doctor.entity';
import {
  InvalidCommissionConfigException,
  InvalidLabPanelRefException,
  InvalidLabTestRefException,
  ReferralDoctorNotFoundException,
} from './exceptions/referral-doctor.exceptions';

/** Assigned lab test/panel references for one referral doctor, keyed by doctor id. */
interface LabLists {
  labTestList: ClassificationRef[];
  labPanelList: ClassificationRef[];
}

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

/** The normalised commission columns written to the `referral_doctors` row. */
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
 * Referral-doctor registry management. Tenant-scoped, tenant-level (CLAUDE.md
 * §4.6): the registry belongs to the business as a whole, not a branch. Every
 * query carries `tenantId` (defence in depth on top of RLS, §4.3) and filters
 * soft-deleted rows. Classification ids (`departmentId`/`categoryId`/
 * `subCategoryId`) are validated against the caller's tenant via the injected
 * Department/Category/SubCategory services (CLAUDE.md rule #3 — never import
 * another service's file directly). Qualifications, experiences, and assigned lab
 * tests/panels are managed via the parent (replace-on-update). Commission/incentive
 * config is validated against the effective (merged, on update) state and the
 * stored data is normalised so dependent fields are nulled out when they don't
 * apply. `fullName`/`age`/per-experience `duration` are derived here, not stored.
 */
@Injectable()
export class ReferralDoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departmentService: DepartmentService,
    private readonly categoryService: CategoryService,
    private readonly subCategoryService: SubCategoryService,
    private readonly referralPanelSettingsService: ReferralPanelSettingsService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /referral-doctors/options`). Tenant-scoped to non-deleted referral
   * doctors; optionally filtered by a case-insensitive `firstName` search. The
   * `name` is the doctor's first + last name joined. Returns the full array when
   * `page` is omitted, or a paginated envelope when `page` is supplied.
   * @param tenantId tenant scope
   * @param filters optional `search` and opt-in `page`/`limit`
   * @returns the full `{ id, name }[]` array, or a paginated `{ data, total, page, limit }` envelope
   */
  async findOptions(
    tenantId: string,
    filters: {
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<
    | Array<{ id: string; name: string }>
    | PaginatedResult<{ id: string; name: string }>
  > {
    const where: Prisma.ReferralDoctorWhereInput = {
      tenantId,
      deletedAt: null,
    };
    const search = filters.search?.trim();
    if (search) {
      where.firstName = { contains: search, mode: 'insensitive' };
    }

    const select = { id: true, firstName: true, lastName: true } as const;
    const orderBy = { firstName: 'asc' } as const;
    const toName = (r: { firstName: string; lastName: string | null }) =>
      [r.firstName, r.lastName].filter(Boolean).join(' ');

    if (filters.page === undefined) {
      const rows = await this.prisma.referralDoctor.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: toName(r) }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.referralDoctor.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.referralDoctor.count({ where }),
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
   * Register a referral doctor with its qualifications, experiences, and assigned
   * lab tests/panels in one transaction. Classification links (if supplied) are
   * validated to be active rows of the same tenant; commission/incentive config is
   * validated and normalised; assigned `labTestId`/`labPanelId`s are validated to
   * be active items in the tenant.
   * @param tenantId owning tenant (from the JWT, never the body)
   * @param dto validated payload
   * @returns the created referral doctor with its children and derived fields
   * @throws DepartmentNotFoundException / CategoryNotFoundException /
   *   SubCategoryNotFoundException if a supplied classification id isn't an active
   *   row of this tenant
   * @throws InvalidCommissionConfigException on a commission/incentive invariant
   * @throws InvalidLabTestRefException / InvalidLabPanelRefException on a bad ref
   */
  async create(
    tenantId: string,
    dto: CreateReferralDoctorDto,
  ): Promise<ReferralDoctorDetail> {
    await this.validateClassification(
      tenantId,
      dto.departmentId,
      dto.categoryId,
      dto.subCategoryId,
    );
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

    const data: Prisma.ReferralDoctorUncheckedCreateInput = {
      tenantId,
      branchId: dto.branchId ?? null,
      firstName: dto.firstName,
      middleName: dto.middleName ?? null,
      lastName: dto.lastName ?? null,
      gender: dto.gender ?? undefined,
      dateOfBirth: this.toDate(dto.dateOfBirth),
      mobileNumber: dto.mobileNumber,
      email: dto.email ?? null,
      aadhaarNumber: dto.aadhaarNumber ?? null,
      panNumber: dto.panNumber ?? null,
      departmentId: dto.departmentId ?? null,
      categoryId: dto.categoryId ?? null,
      subCategoryId: dto.subCategoryId ?? null,
      referralPanelSettingsId: dto.referralPanelSettingsId ?? null,
      medicalLicenseNumber: dto.medicalLicenseNumber ?? null,
      registrationCouncil: dto.registrationCouncil ?? null,
      registrationValidTill: this.toDate(dto.registrationValidTill),
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
      status: dto.status ?? ReferralDoctorStatus.ACTIVE,
      qualifications: {
        create: (dto.qualifications ?? []).map((q) =>
          this.toQualificationCreate(tenantId, q),
        ),
      },
      experiences: {
        create: (dto.experiences ?? []).map((e) =>
          this.toExperienceCreate(tenantId, e),
        ),
      },
    };

    const createdId = await this.prisma.withTenant(tenantId, async (tx) => {
      const doctor = await tx.referralDoctor.create({ data });
      await this.writeLabRefs(tx, tenantId, doctor.id, testIds, panelIds);
      return doctor.id;
    });
    return this.findById(createdId, tenantId);
  }

  /**
   * List active referral doctors for a tenant (offset pagination), returning the
   * trimmed listing projection. Supports a free-text `search` by doctor name
   * (whitespace-tokenised across first/middle/last name, with the mobile number as
   * a fallback) plus `departmentId`, `categoryId`, and `status` filters.
   * @param tenantId tenant scope
   * @param query pagination + filters
   */
  async findAllForTenant(
    tenantId: string,
    query: ListReferralDoctorsDto,
  ): Promise<PaginatedResult<ReferralDoctorListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ReferralDoctorWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.categoryId) where.categoryId = query.categoryId;
    const term = query.search?.trim();
    if (term) {
      // Search by doctor name: split into whitespace tokens and require EACH to
      // match some name part (first/middle/last) — so "Anita Sharma" matches a
      // doctor whose first name is "Anita" and last name is "Sharma", and a single
      // token still matches any part. The mobile number is matched as a fallback.
      where.AND = term.split(/\s+/).map((token) => ({
        OR: [
          { firstName: { contains: token, mode: 'insensitive' } },
          { middleName: { contains: token, mode: 'insensitive' } },
          { lastName: { contains: token, mode: 'insensitive' } },
          { mobileNumber: { contains: token, mode: 'insensitive' } },
        ],
      }));
    }

    const [rows, total] = await Promise.all([
      this.prisma.referralDoctor.findMany({
        where,
        select: REFERRAL_DOCTOR_LIST_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.referralDoctor.count({ where }),
    ]);
    const labLists = await this.resolveLabLists(
      tenantId,
      rows.map((r) => r.id),
    );
    return {
      data: rows.map((r) =>
        this.toListItem(
          r,
          labLists.get(r.id) ?? { labTestList: [], labPanelList: [] },
        ),
      ),
      total,
      page,
      limit,
    };
  }

  /**
   * Fetch one active referral doctor scoped to its tenant, with all active
   * qualifications, experiences, and assigned lab tests/panels (each enriched with
   * the referenced test/panel name + code), plus the derived `fullName`, `age`, and
   * per-experience `duration`.
   * @param id referral doctor id
   * @param tenantId tenant scope
   * @throws ReferralDoctorNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<ReferralDoctorDetail> {
    const doctor = await this.prisma.referralDoctor.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: REFERRAL_DOCTOR_DETAIL_INCLUDE,
    });
    if (!doctor) {
      throw new ReferralDoctorNotFoundException(id);
    }
    return this.toDetail(tenantId, doctor);
  }

  /**
   * Update a referral doctor. Only supplied fields change. When a classification id
   * is supplied it is re-validated against the tenant. Commission/incentive config
   * is re-validated and normalised against the merged (existing + patch) state when
   * any related field is present. When `qualifications`/`experiences`/`labTestIds`/
   * `labPanelIds` is supplied, that whole set is REPLACED (existing active rows
   * soft-deleted, the new set created); omit to leave it unchanged. All in one
   * transaction.
   * @param id referral doctor id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws ReferralDoctorNotFoundException if missing/soft-deleted
   * @throws DepartmentNotFoundException / CategoryNotFoundException /
   *   SubCategoryNotFoundException / InvalidCommissionConfigException /
   *   InvalidLabTestRefException / InvalidLabPanelRefException
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateReferralDoctorDto,
  ): Promise<ReferralDoctorDetail> {
    const existing = await this.findById(id, tenantId);
    await this.validateClassification(
      tenantId,
      dto.departmentId,
      dto.categoryId,
      dto.subCategoryId,
    );
    await this.assertSettingsRef(tenantId, dto.referralPanelSettingsId);
    await this.assertBranchRef(tenantId, dto.branchId);

    const testIds = dto.labTestIds;
    const panelIds = dto.labPanelIds;
    if (testIds !== undefined || panelIds !== undefined) {
      await this.assertLabRefs(tenantId, testIds ?? [], panelIds ?? []);
    }

    let data: Prisma.ReferralDoctorUpdateInput = this.toScalarUpdateData(dto);

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

    const now = new Date();
    await this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.qualifications !== undefined) {
        await tx.referralDoctorQualification.updateMany({
          where: { referralDoctorId: id, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
        data.qualifications = {
          create: dto.qualifications.map((q) =>
            this.toQualificationCreate(tenantId, q),
          ),
        };
      }
      if (dto.experiences !== undefined) {
        await tx.referralDoctorExperience.updateMany({
          where: { referralDoctorId: id, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
        data.experiences = {
          create: dto.experiences.map((e) =>
            this.toExperienceCreate(tenantId, e),
          ),
        };
      }

      await tx.referralDoctor.update({ where: { id }, data });

      if (testIds !== undefined) {
        await tx.referralDoctorLabTest.updateMany({
          where: { referralDoctorId: id, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
      }
      if (panelIds !== undefined) {
        await tx.referralDoctorLabPanel.updateMany({
          where: { referralDoctorId: id, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
      }
      await this.writeLabRefs(tx, tenantId, id, testIds ?? [], panelIds ?? []);
    });
    return this.findById(id, tenantId);
  }

  /**
   * Soft-delete a referral doctor and cascade soft-delete its active
   * qualifications, experiences, and assigned lab tests/panels in one transaction.
   * @param id referral doctor id
   * @param tenantId tenant scope
   * @throws ReferralDoctorNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<ReferralDoctorDetail> {
    await this.findById(id, tenantId);
    const now = new Date();
    const scope = { referralDoctorId: id, tenantId, deletedAt: null };
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.referralDoctorQualification.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
      await tx.referralDoctorExperience.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
      await tx.referralDoctorLabTest.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
      await tx.referralDoctorLabPanel.updateMany({
        where: scope,
        data: { deletedAt: now },
      });
      await tx.referralDoctor.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
    // Re-fetch ignoring the soft-delete filter so the caller gets the final state.
    const removed = await this.prisma.referralDoctor.findUnique({
      where: { id },
      include: REFERRAL_DOCTOR_DETAIL_INCLUDE,
    });
    // `removed` is guaranteed present (we just updated it); narrow for the type.
    return this.toDetail(tenantId, removed as ReferralDoctorWithRelations);
  }

  // ── Validation helpers ──────────────────────────────────────────────────────

  /**
   * Validate that supplied classification ids belong to active rows of this
   * tenant. Each lookup throws its own typed NotFound exception if it doesn't.
   * @param tenantId tenant scope
   * @param departmentId candidate department id, if any
   * @param categoryId candidate category id (Specialty), if any
   * @param subCategoryId candidate sub-category id (Super Specialty), if any
   */
  private async validateClassification(
    tenantId: string,
    departmentId: string | undefined,
    categoryId: string | undefined,
    subCategoryId: string | undefined,
  ): Promise<void> {
    if (departmentId) {
      await this.departmentService.findById(departmentId, tenantId);
    }
    if (categoryId) {
      await this.categoryService.findById(categoryId, tenantId);
    }
    if (subCategoryId) {
      await this.subCategoryService.findById(subCategoryId, tenantId);
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
   * Persist a referral doctor's assigned lab tests and lab panels. Assumes the ids
   * were already validated by `assertLabRefs` (no-op for empty lists).
   * @param tx active transaction client
   * @param tenantId tenant scope
   * @param referralDoctorId owning referral doctor
   * @param testIds assigned lab-test ids
   * @param panelIds assigned lab-panel ids
   */
  private async writeLabRefs(
    tx: Prisma.TransactionClient,
    tenantId: string,
    referralDoctorId: string,
    testIds: string[],
    panelIds: string[],
  ): Promise<void> {
    if (testIds.length) {
      await tx.referralDoctorLabTest.createMany({
        data: testIds.map((labTestId) => ({
          tenantId,
          referralDoctorId,
          labTestId,
        })),
      });
    }
    if (panelIds.length) {
      await tx.referralDoctorLabPanel.createMany({
        data: panelIds.map((labPanelId) => ({
          tenantId,
          referralDoctorId,
          labPanelId,
        })),
      });
    }
  }

  /**
   * Build the scalar update payload (personal/professional/payment/attachment/status
   * fields) from an update DTO. Only fields present on the DTO are written;
   * commission/incentive and child-list fields are handled separately.
   * @param dto the update DTO
   */
  private toScalarUpdateData(
    dto: UpdateReferralDoctorDto,
  ): Prisma.ReferralDoctorUpdateInput {
    const data: Prisma.ReferralDoctorUpdateInput = {};
    // Personal
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.middleName !== undefined) data.middleName = dto.middleName ?? null;
    if (dto.lastName !== undefined) data.lastName = dto.lastName ?? null;
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = this.toDate(dto.dateOfBirth);
    }
    if (dto.mobileNumber !== undefined) data.mobileNumber = dto.mobileNumber;
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.aadhaarNumber !== undefined) {
      data.aadhaarNumber = dto.aadhaarNumber ?? null;
    }
    if (dto.panNumber !== undefined) data.panNumber = dto.panNumber ?? null;
    if (dto.branchId !== undefined) data.branchId = dto.branchId ?? null;
    // Professional
    if (dto.departmentId !== undefined) {
      data.department = dto.departmentId
        ? { connect: { id: dto.departmentId } }
        : { disconnect: true };
    }
    if (dto.categoryId !== undefined) {
      data.category = dto.categoryId
        ? { connect: { id: dto.categoryId } }
        : { disconnect: true };
    }
    if (dto.subCategoryId !== undefined) {
      data.subCategory = dto.subCategoryId
        ? { connect: { id: dto.subCategoryId } }
        : { disconnect: true };
    }
    if (dto.referralPanelSettingsId !== undefined) {
      data.referralPanelSettings = dto.referralPanelSettingsId
        ? { connect: { id: dto.referralPanelSettingsId } }
        : { disconnect: true };
    }
    if (dto.medicalLicenseNumber !== undefined) {
      data.medicalLicenseNumber = dto.medicalLicenseNumber ?? null;
    }
    if (dto.registrationCouncil !== undefined) {
      data.registrationCouncil = dto.registrationCouncil ?? null;
    }
    if (dto.registrationValidTill !== undefined) {
      data.registrationValidTill = this.toDate(dto.registrationValidTill);
    }
    // TDS & payment & attachment & status
    if (dto.isTdsApplicable !== undefined)
      data.isTdsApplicable = dto.isTdsApplicable;
    if (dto.paymentCycle !== undefined) data.paymentCycle = dto.paymentCycle;
    if (dto.paymentMode !== undefined) data.paymentMode = dto.paymentMode;
    if (dto.monthlyTargetAmount !== undefined) {
      data.monthlyTargetAmount = dto.monthlyTargetAmount;
    }
    if (dto.fileName !== undefined) data.fileName = dto.fileName ?? null;
    if (dto.fileUrl !== undefined) data.fileUrl = dto.fileUrl ?? null;
    if (dto.remarks !== undefined) data.remarks = dto.remarks ?? null;
    if (dto.status !== undefined) data.status = dto.status;
    return data;
  }

  /**
   * Shape a validated qualification DTO into a nested-create row, stamping the
   * tenant (referralDoctorId comes from the parent create/update).
   * @param tenantId tenant scope (set from context, never the body)
   * @param q the validated qualification
   */
  private toQualificationCreate(
    tenantId: string,
    q: ReferralDoctorQualificationDto,
  ): Prisma.ReferralDoctorQualificationCreateWithoutReferralDoctorInput {
    return {
      tenantId,
      qualificationType: q.qualificationType ?? null,
      degreeName: q.degreeName ?? null,
      institutionName: q.institutionName ?? null,
      yearOfCompletion: q.yearOfCompletion ?? null,
      percentageGrade: q.percentageGrade ?? null,
    };
  }

  /**
   * Shape a validated experience DTO into a nested-create row, stamping the tenant.
   * `toDate` null means the engagement is current.
   * @param tenantId tenant scope (set from context, never the body)
   * @param e the validated experience
   */
  private toExperienceCreate(
    tenantId: string,
    e: ReferralDoctorExperienceDto,
  ): Prisma.ReferralDoctorExperienceCreateWithoutReferralDoctorInput {
    return {
      tenantId,
      position: e.position ?? null,
      organisation: e.organisation ?? null,
      fromDate: this.toDate(e.fromDate),
      toDate: this.toDate(e.toDate),
    };
  }

  // ── Response shaping & derived fields ───────────────────────────────────────

  /**
   * Compose the GET-single response: enrich assigned lab tests/panels with their
   * resolved name/code and add the derived `fullName`, `age`, and per-experience
   * `duration`.
   * @param tenantId tenant scope (for resolving lab test/panel names)
   * @param doctor the loaded referral doctor with relations
   */
  private async toDetail(
    tenantId: string,
    doctor: ReferralDoctorWithRelations,
  ): Promise<ReferralDoctorDetail> {
    const testIds = [...new Set(doctor.labTests.map((t) => t.labTestId))];
    const panelIds = [...new Set(doctor.labPanels.map((p) => p.labPanelId))];

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
      ...doctor,
      fullName: this.computeFullName(
        doctor.firstName,
        doctor.middleName,
        doctor.lastName,
      ),
      age: this.computeAge(doctor.dateOfBirth),
      experiences: doctor.experiences.map((e) => ({
        ...e,
        duration: this.computeDuration(e.fromDate, e.toDate),
      })),
      labTests: doctor.labTests.map((t) => ({
        ...t,
        testName: testMap.get(t.labTestId)?.testName ?? null,
        testCode: testMap.get(t.labTestId)?.testCode ?? null,
      })),
      labPanels: doctor.labPanels.map((p) => ({
        ...p,
        panelName: panelMap.get(p.labPanelId)?.panelName ?? null,
        panelCode: panelMap.get(p.labPanelId)?.panelCode ?? null,
      })),
    };
  }

  /**
   * Reshape a selected list row into the listing response (composed `fullName`,
   * `specialty` ← category, `superSpecialty` ← sub-category) and attach the
   * resolved assigned lab test/panel references.
   * @param row a row from `REFERRAL_DOCTOR_LIST_SELECT`
   * @param labLists the doctor's assigned lab test/panel references
   */
  private toListItem(
    row: ReferralDoctorListRow,
    labLists: LabLists,
  ): ReferralDoctorListItem {
    return {
      id: row.id,
      fullName: this.computeFullName(
        row.firstName,
        row.middleName,
        row.lastName,
      ),
      mobileNumber: row.mobileNumber,
      email: row.email,
      department: row.department,
      specialty: row.category,
      superSpecialty: row.subCategory,
      isCommissionApplicable: row.isCommissionApplicable,
      commissionType: row.commissionType,
      tds: row.tds,
      paymentCycle: row.paymentCycle,
      labTestList: labLists.labTestList,
      labPanelList: labLists.labPanelList,
      status: row.status,
    };
  }

  /**
   * Resolve the assigned lab test/panel references for a page of referral doctors,
   * keyed by doctor id, each shaped as `[{ id, name }]`. Uses a bounded number of
   * queries regardless of page size: one per join table plus one per lab model
   * (no N+1). Names of since-deleted lab tests/panels are omitted.
   * @param tenantId tenant scope
   * @param doctorIds the doctor ids on the current page
   */
  private async resolveLabLists(
    tenantId: string,
    doctorIds: string[],
  ): Promise<Map<string, LabLists>> {
    const result = new Map<string, LabLists>();
    for (const id of doctorIds) {
      result.set(id, { labTestList: [], labPanelList: [] });
    }
    if (doctorIds.length === 0) {
      return result;
    }

    const [testLinks, panelLinks] = await Promise.all([
      this.prisma.referralDoctorLabTest.findMany({
        where: {
          referralDoctorId: { in: doctorIds },
          tenantId,
          deletedAt: null,
        },
        select: { referralDoctorId: true, labTestId: true },
      }),
      this.prisma.referralDoctorLabPanel.findMany({
        where: {
          referralDoctorId: { in: doctorIds },
          tenantId,
          deletedAt: null,
        },
        select: { referralDoctorId: true, labPanelId: true },
      }),
    ]);

    const testIds = [...new Set(testLinks.map((l) => l.labTestId))];
    const panelIds = [...new Set(panelLinks.map((l) => l.labPanelId))];
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
    const testName = new Map(tests.map((t) => [t.id, t.testName]));
    const panelName = new Map(panels.map((p) => [p.id, p.panelName]));

    for (const link of testLinks) {
      const name = testName.get(link.labTestId);
      const entry = result.get(link.referralDoctorId);
      if (name !== undefined && entry) {
        entry.labTestList.push({ id: link.labTestId, name });
      }
    }
    for (const link of panelLinks) {
      const name = panelName.get(link.labPanelId);
      const entry = result.get(link.referralDoctorId);
      if (name !== undefined && entry) {
        entry.labPanelList.push({ id: link.labPanelId, name });
      }
    }
    return result;
  }

  /** Compose a full name from the name parts (empty parts dropped). */
  private computeFullName(
    first: string,
    middle: string | null,
    last: string | null,
  ): string {
    return [first, middle, last].filter(Boolean).join(' ');
  }

  /**
   * Whole-year age from a date of birth (null when no DOB; never negative).
   * @param dob the date of birth, or null
   */
  private computeAge(dob: Date | null): number | null {
    if (!dob) return null;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDiff = now.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
      age -= 1;
    }
    return age >= 0 ? age : null;
  }

  /**
   * A human-readable engagement duration ("2 yr 3 mo") from `fromDate` to `toDate`
   * (or now when current). Null when there is no `fromDate`.
   * @param fromDate start date, or null
   * @param toDate end date, or null (current)
   */
  private computeDuration(
    fromDate: Date | null,
    toDate: Date | null,
  ): string | null {
    if (!fromDate) return null;
    const end = toDate ?? new Date();
    let months =
      (end.getFullYear() - fromDate.getFullYear()) * 12 +
      (end.getMonth() - fromDate.getMonth());
    if (end.getDate() < fromDate.getDate()) months -= 1;
    if (months < 0) months = 0;
    const years = Math.floor(months / 12);
    const remMonths = months % 12;
    const parts: string[] = [];
    if (years) parts.push(`${years} yr`);
    if (remMonths) parts.push(`${remMonths} mo`);
    if (!parts.length) parts.push('0 mo');
    return parts.join(' ');
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
