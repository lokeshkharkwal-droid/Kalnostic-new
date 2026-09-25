import { Injectable } from '@nestjs/common';
import {
  CommissionType,
  FixedCommissionCycle,
  PaymentCycle,
  Prisma,
  ReferralClientType,
  ReferralPanel,
  ReferralPaymentMode,
  ReferralType,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { KaltrosException } from '../../common/exceptions/kaltros.exception';
import { BranchService } from '../branch/branch.service';
import { ReferralListAssignmentService } from '../referral-list/referral-list-assignment.service';
import { ReferralPanelSettingsService } from '../referral-panel-settings/referral-panel-settings.service';
import { ReferralUsageService } from '../referral-usage/referral-usage.service';
import { CreateReferralPanelDto } from './dto/create-referral-panel.dto';
import { UpdateReferralPanelDto } from './dto/update-referral-panel.dto';
import { ListReferralPanelsDto } from './dto/list-referral-panels.dto';
import {
  BonusSlab,
  CommissionSlab,
  ReferralPanelEntity,
  ReferralPanelImportResult,
  ReferralPanelImportSkippedRow,
  ReferralPanelListItem,
} from './entities/referral-panel.entity';
import {
  InvalidCommissionConfigException,
  ReferralPanelCodeConflictException,
  ReferralPanelImportFileException,
  ReferralPanelInUseException,
  ReferralPanelNameConflictException,
  ReferralPanelNotFoundException,
} from './exceptions/referral-panel.exceptions';

/** How one import column's raw cell text is coerced into its create-DTO field. */
type ImportColumnKind =
  | 'string'
  | 'number'
  | 'int'
  | 'bool'
  | 'status'
  | 'clientType'
  | 'commissionType'
  | 'fixedCycle'
  | 'paymentCycle'
  | 'paymentMode';

/**
 * One bulk-import column: the create-DTO field it feeds, its coercion kind, and
 * the accepted header labels. Headers are matched case-insensitively after
 * normalisation (lower-cased, punctuation/`*` collapsed to spaces), so
 * `"TDS %"`, `"Referring Panel Name*"` etc. all match. The first alias is the
 * canonical header; earlier aliases win when several are present (e.g. an
 * explicit `… ID` column is preferred over the human-readable `… Name` column).
 */
interface ImportColumnSpec {
  field: keyof CreateReferralPanelDto;
  kind: ImportColumnKind;
  aliases: string[];
}

/**
 * The scalar import columns (every column except the two slab triples, which are
 * assembled separately into `commissionSlabs` / `bonusSlabs`). Referral panel
 * settings, branch and both lab lists are supplied as IDs — either in a dedicated
 * `… ID` column or in the corresponding human-readable column.
 */
const REFERRAL_PANEL_IMPORT_COLUMNS: readonly ImportColumnSpec[] = [
  { field: 'panelCode', kind: 'string', aliases: ['Panel Code'] },
  {
    field: 'name',
    kind: 'string',
    aliases: ['Referring Panel Name', 'Referral Panel Name'],
  },
  { field: 'shortName', kind: 'string', aliases: ['Short Name'] },
  { field: 'clientType', kind: 'clientType', aliases: ['Client Type'] },
  {
    field: 'referralPanelSettingsId',
    kind: 'string',
    aliases: [
      'Referral Panel Settings ID',
      'Referral Panel Settings Name',
      'Referral Panel Setting Name',
    ],
  },
  { field: 'isActive', kind: 'status', aliases: ['Status'] },
  { field: 'addressLine1', kind: 'string', aliases: ['Address Line 1'] },
  { field: 'addressLine2', kind: 'string', aliases: ['Address Line 2'] },
  { field: 'city', kind: 'string', aliases: ['City'] },
  { field: 'state', kind: 'string', aliases: ['State'] },
  { field: 'country', kind: 'string', aliases: ['Country'] },
  { field: 'pincode', kind: 'string', aliases: ['PIN Code', 'Pincode', 'PIN'] },
  { field: 'gstNumber', kind: 'string', aliases: ['GST Number', 'GST'] },
  { field: 'panNumber', kind: 'string', aliases: ['PAN Number', 'PAN'] },
  {
    field: 'accountHolderName',
    kind: 'string',
    aliases: ['Account Holder Name'],
  },
  { field: 'bankName', kind: 'string', aliases: ['Bank Name'] },
  { field: 'accountNumber', kind: 'string', aliases: ['Account Number'] },
  { field: 'ifscCode', kind: 'string', aliases: ['IFSC Code', 'IFSC'] },
  { field: 'directorName', kind: 'string', aliases: ['Director Name'] },
  { field: 'directorMobile', kind: 'string', aliases: ['Director Mobile'] },
  { field: 'directorEmail', kind: 'string', aliases: ['Director Email'] },
  {
    field: 'accessionPersonName',
    kind: 'string',
    aliases: ['Accession Person Name'],
  },
  {
    field: 'accessionPersonMobile',
    kind: 'string',
    aliases: ['Accession Person Mobile'],
  },
  {
    field: 'accessionPersonEmail',
    kind: 'string',
    aliases: ['Accession Person Email'],
  },
  {
    field: 'registrationPersonName',
    kind: 'string',
    aliases: ['Registration Person Name'],
  },
  {
    field: 'registrationPersonMobile',
    kind: 'string',
    aliases: ['Registration Person Mobile'],
  },
  {
    field: 'registrationPersonEmail',
    kind: 'string',
    aliases: ['Registration Person Email'],
  },
  {
    field: 'logisticsPersonName',
    kind: 'string',
    aliases: ['Logistics Person Name'],
  },
  {
    field: 'logisticsPersonMobile',
    kind: 'string',
    aliases: ['Logistics Person Mobile'],
  },
  {
    field: 'logisticsPersonEmail',
    kind: 'string',
    aliases: ['Logistics Person Email'],
  },
  {
    field: 'accountsPersonName',
    kind: 'string',
    aliases: ['Accounts Person Name'],
  },
  {
    field: 'accountsPersonMobile',
    kind: 'string',
    aliases: ['Accounts Person Mobile'],
  },
  {
    field: 'accountsPersonEmail',
    kind: 'string',
    aliases: ['Accounts Person Email'],
  },
  {
    field: 'branchLabTestListId',
    kind: 'string',
    aliases: ['Lab Test List ID', 'Lab Test List'],
  },
  {
    field: 'branchLabPanelListId',
    kind: 'string',
    aliases: ['Lab Panel List ID', 'Lab Panel List'],
  },
  {
    field: 'isCommissionApplicable',
    kind: 'bool',
    aliases: ['Commission Applicable'],
  },
  {
    field: 'commissionType',
    kind: 'commissionType',
    aliases: ['Commission Type'],
  },
  {
    field: 'commissionPctLabTest',
    kind: 'number',
    aliases: ['Commission % on Lab Test List', 'Commission % on Lab Test'],
  },
  {
    field: 'commissionPctLabPanel',
    kind: 'number',
    aliases: ['Commission % on Lab Panel List', 'Commission % on Lab Panel'],
  },
  {
    field: 'fixedCommissionCycle',
    kind: 'fixedCycle',
    aliases: ['Fixed Type'],
  },
  { field: 'fixedAmount', kind: 'number', aliases: ['Fixed Amount'] },
  { field: 'isTdsApplicable', kind: 'bool', aliases: ['TDS Applicable'] },
  { field: 'tds', kind: 'int', aliases: ['TDS %', 'TDS'] },
  { field: 'paymentCycle', kind: 'paymentCycle', aliases: ['Payment Cycle'] },
  { field: 'paymentMode', kind: 'paymentMode', aliases: ['Payment Mode'] },
  {
    field: 'monthlyTargetAmount',
    kind: 'int',
    aliases: ['Monthly Target Amount'],
  },
  {
    field: 'isIncentiveBonusApplicable',
    kind: 'bool',
    aliases: ['Incentive Bonus Applicable'],
  },
  { field: 'remarks', kind: 'string', aliases: ['Remarks'] },
  { field: 'branchId', kind: 'string', aliases: ['Branch ID', 'Branch Id'] },
];

/** Header aliases for the single commission slab triple (one slab per row). */
const COMMISSION_SLAB_HEADERS = {
  from: [
    'Slab Based - Monthly Business From',
    'Slab Based Monthly Business From',
  ],
  to: ['Slab Based - Monthly Business To', 'Slab Based Monthly Business To'],
  pct: ['Slab Based - Commission %', 'Slab Based Commission %'],
} as const;

/** Header aliases for the single incentive-bonus slab triple (one slab per row). */
const BONUS_SLAB_HEADERS = {
  from: [
    'Incentive Bonus - Monthly Business From',
    'Incentive Bonus Monthly Business From',
  ],
  to: [
    'Incentive Bonus - Monthly Business To',
    'Incentive Bonus Monthly Business To',
  ],
  pct: ['Incentive / Bonus %', 'Incentive Bonus %'],
} as const;

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
    private readonly referralUsage: ReferralUsageService,
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
   * Bulk-create referral panels from an uploaded `.xlsx` workbook (one data row =
   * one panel). Every column of the referral-panel template is mapped
   * (basic/address/bank/contact fields, the Client Type / Commission Type / Fixed
   * Type / Payment Cycle / Payment Mode enums, the commission & incentive-bonus
   * slab triples, TDS, and the settings / branch / lab-test-list / lab-panel-list
   * IDs). CREATE-ONLY, SKIP-AND-REPORT: each row is validated against
   * `CreateReferralPanelDto` and then created via {@link create} (reusing all its
   * code-generation, commission/incentive validation, settings/branch checks, and
   * per-branch list assignment); an invalid or conflicting row is skipped and
   * reported in the result's `skipped[]` (with its worksheet row number and
   * reason), while every valid row still imports. Only a file-level structural
   * failure (unreadable file / missing header row / no data rows) rejects the
   * whole upload.
   * @param tenantId owning tenant (from the JWT)
   * @param actorId person id recorded as created-by on each created panel's list
   *   assignment (from the JWT)
   * @param buffer the uploaded workbook bytes
   * @returns `{ total, created, skipped[] }`
   * @throws ReferralPanelImportFileException on a file-level structural failure
   */
  async importXlsx(
    tenantId: string,
    actorId: string | null,
    buffer: Buffer,
  ): Promise<ReferralPanelImportResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new ReferralPanelImportFileException(
        'The uploaded file could not be read — make sure it is a valid .xlsx workbook',
      );
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new ReferralPanelImportFileException(
        'The workbook has no worksheets',
      );
    }

    // ── Locate the header row by content (the first of the first ~10 rows that
    //    contains the "Referring Panel Name" column), then index every header
    //    cell by its normalised label. ──────────────────────────────────────
    const maxScanRow = Math.min(sheet.lastRow?.number ?? 1, 10);
    const nameKeys = REFERRAL_PANEL_IMPORT_COLUMNS.find(
      (c) => c.field === 'name',
    )!.aliases.map((a) => this.normalizeHeader(a));
    let headerRowNum = -1;
    for (let r = 1; r <= maxScanRow; r++) {
      const row = sheet.getRow(r);
      let found = false;
      row.eachCell((cell) => {
        if (
          nameKeys.includes(this.normalizeHeader(this.cellToString(cell.value)))
        )
          found = true;
      });
      if (found) {
        headerRowNum = r;
        break;
      }
    }
    if (headerRowNum === -1) {
      throw new ReferralPanelImportFileException(
        `Could not find the header row (looking for a "Referring Panel Name" column in the first ${maxScanRow} rows)`,
      );
    }

    const headerIndex = new Map<string, number>();
    sheet.getRow(headerRowNum).eachCell((cell, colNumber) => {
      const key = this.normalizeHeader(this.cellToString(cell.value));
      if (key && !headerIndex.has(key)) headerIndex.set(key, colNumber);
    });
    const resolveCol = (aliases: readonly string[]): number | undefined => {
      for (const alias of aliases) {
        const col = headerIndex.get(this.normalizeHeader(alias));
        if (col !== undefined) return col;
      }
      return undefined;
    };

    // The two structurally-required columns give clear, early file-level errors
    // (without them every row would fail the same way).
    for (const field of ['name', 'clientType'] as const) {
      const spec = REFERRAL_PANEL_IMPORT_COLUMNS.find(
        (c) => c.field === field,
      )!;
      if (resolveCol(spec.aliases) === undefined) {
        throw new ReferralPanelImportFileException(
          `Missing required column: ${spec.aliases[0]}`,
        );
      }
    }

    const scalarCols = REFERRAL_PANEL_IMPORT_COLUMNS.map((spec) => ({
      spec,
      col: resolveCol(spec.aliases),
    }));
    const commissionSlabCols = {
      from: resolveCol(COMMISSION_SLAB_HEADERS.from),
      to: resolveCol(COMMISSION_SLAB_HEADERS.to),
      pct: resolveCol(COMMISSION_SLAB_HEADERS.pct),
    };
    const bonusSlabCols = {
      from: resolveCol(BONUS_SLAB_HEADERS.from),
      to: resolveCol(BONUS_SLAB_HEADERS.to),
      pct: resolveCol(BONUS_SLAB_HEADERS.pct),
    };

    const lastRow = sheet.lastRow?.number ?? headerRowNum;
    const skipped: ReferralPanelImportSkippedRow[] = [];
    let total = 0;
    let created = 0;

    for (let rowNum = headerRowNum + 1; rowNum <= lastRow; rowNum++) {
      const row = sheet.getRow(rowNum);
      const cellAt = (col: number | undefined): string =>
        col ? this.cellToString(row.getCell(col).value) : '';

      // Skip a fully-blank spacer row (no cell has any content).
      const hasAnyValue = scalarCols.some(({ col }) => cellAt(col) !== '');
      if (!hasAnyValue) continue;
      total++;

      // Build a plain create-DTO-shaped object from the row's cells.
      const obj: Record<string, unknown> = {};
      for (const { spec, col } of scalarCols) {
        if (col === undefined) continue;
        const value = this.coerceImportCell(spec.kind, cellAt(col));
        if (value !== undefined) obj[spec.field] = value;
      }
      const commissionSlab = this.buildImportSlab(
        cellAt(commissionSlabCols.from),
        cellAt(commissionSlabCols.to),
        cellAt(commissionSlabCols.pct),
        'commissionPct',
      );
      if (commissionSlab) obj.commissionSlabs = [commissionSlab];
      const bonusSlab = this.buildImportSlab(
        cellAt(bonusSlabCols.from),
        cellAt(bonusSlabCols.to),
        cellAt(bonusSlabCols.pct),
        'bonusPct',
      );
      if (bonusSlab) obj.bonusSlabs = [bonusSlab];

      const name = typeof obj.name === 'string' ? obj.name : null;
      const panelCode =
        typeof obj.panelCode === 'string' ? obj.panelCode : null;

      // Validate against the create DTO (reusing its conditional rules), then
      // create — recording any per-row failure in `skipped` and moving on.
      const dto = plainToInstance(CreateReferralPanelDto, obj);
      const errors = await validate(dto, {
        whitelist: true,
        forbidUnknownValues: false,
      });
      if (errors.length) {
        skipped.push({
          rowNumber: rowNum,
          name,
          panelCode,
          reason: this.formatValidationErrors(errors),
        });
        continue;
      }

      try {
        await this.create(tenantId, dto.branchId ?? null, actorId, dto);
        created++;
      } catch (e) {
        skipped.push({
          rowNumber: rowNum,
          name,
          panelCode,
          reason:
            e instanceof KaltrosException
              ? this.extractKaltrosMessage(e)
              : e instanceof Error
                ? e.message
                : 'Unexpected error while creating the panel',
        });
      }
    }

    return { total, created, skipped };
  }

  /**
   * The human-readable message from a `KaltrosException` — it lives in the
   * HttpException response body (`{ error: { message } }`), not in `Error.message`
   * (which is the generic "Kaltros Exception"). Falls back to `e.message`.
   */
  private extractKaltrosMessage(e: KaltrosException): string {
    const res = e.getResponse();
    if (res && typeof res === 'object') {
      const err = (res as { error?: { message?: unknown } }).error;
      if (err && typeof err.message === 'string') return err.message;
    }
    return e.message;
  }

  /**
   * Normalise a header label for tolerant matching: lower-cased, with every run
   * of non-alphanumeric characters (spaces, `*`, `-`, `/`, `%`, `_`) collapsed to
   * a single space and trimmed. So `"Referring Panel Name*"`, `"TDS %"`, and
   * `"Incentive / Bonus %"` match their canonical aliases.
   */
  private normalizeHeader(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /** A cell's value as a trimmed string (handles ExcelJS rich-text/formula cells). */
  private cellToString(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && 'text' in (value as object)) {
      return this.asImportString((value as { text: unknown }).text);
    }
    if (typeof value === 'object' && 'result' in (value as object)) {
      return this.asImportString((value as { result: unknown }).result);
    }
    return this.asImportString(value);
  }

  /** Safely stringify a cell value of unknown shape (never `[object Object]`). */
  private asImportString(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value instanceof Date) return value.toISOString();
    return '';
  }

  /**
   * Coerce one raw cell string into the value expected by its create-DTO field.
   * A blank cell yields `undefined` (the field is omitted so the DTO/service
   * default applies). Enum kinds are normalised (upper-cased, non-alphanumerics
   * → `_`) and accepted only when they match a real enum member; an unrecognised
   * value is passed through verbatim so the DTO's `@IsEnum` reports it. Numeric
   * kinds pass a parsed number through when finite, else the raw string so the
   * DTO's `@IsNumber`/`@IsInt` reports it.
   */
  private coerceImportCell(kind: ImportColumnKind, raw: string): unknown {
    const str = raw.trim();
    if (str === '') return undefined;
    switch (kind) {
      case 'string':
        return str;
      case 'number':
      case 'int': {
        const n = Number(str);
        return Number.isFinite(n) ? n : str;
      }
      case 'bool':
        return ['true', 'yes', 'y', '1'].includes(str.toLowerCase());
      case 'status': {
        const s = str.toLowerCase();
        if (['active', 'true', 'yes', '1'].includes(s)) return true;
        if (['inactive', 'false', 'no', '0'].includes(s)) return false;
        return str; // unrecognised → let @IsBoolean flag it
      }
      case 'clientType':
        return this.matchEnum(str, ReferralClientType);
      case 'commissionType':
        return this.matchEnum(str, CommissionType);
      case 'fixedCycle':
        return this.matchEnum(str, FixedCommissionCycle);
      case 'paymentCycle':
        return this.matchEnum(str, PaymentCycle);
      case 'paymentMode':
        return this.matchEnum(str, ReferralPaymentMode);
    }
  }

  /**
   * Match a free-text cell to a member of a Prisma enum, tolerating case and
   * separators (`"Bank Transfer"`/`"bank-transfer"` → `BANK_TRANSFER`). Returns
   * the canonical member when matched, else the trimmed input verbatim so the
   * DTO's `@IsEnum` reports the bad value.
   */
  private matchEnum(raw: string, enumObj: Record<string, string>): string {
    const key = raw
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_');
    const values = Object.values(enumObj);
    return values.includes(key) ? key : raw.trim();
  }

  /**
   * Build a single slab object from a row's three slab cells, or `undefined` when
   * all three are blank (no slab on this row). Any non-blank cell yields a slab
   * (with numbers parsed where possible) so a partially-filled slab is validated
   * and reported by the DTO rather than silently dropped.
   */
  private buildImportSlab(
    fromRaw: string,
    toRaw: string,
    pctRaw: string,
    pctKey: 'commissionPct' | 'bonusPct',
  ): Record<string, unknown> | undefined {
    if (fromRaw.trim() === '' && toRaw.trim() === '' && pctRaw.trim() === '') {
      return undefined;
    }
    const num = (s: string): number | string => {
      const n = Number(s.trim());
      return Number.isFinite(n) ? n : s.trim();
    };
    return {
      monthlyBusinessFrom: num(fromRaw),
      monthlyBusinessTo: num(toRaw),
      [pctKey]: num(pctRaw),
    };
  }

  /**
   * Flatten class-validator errors (including one level of nested slab errors)
   * into a short, human-readable reason string for the import `skipped` report.
   */
  private formatValidationErrors(
    errors: import('class-validator').ValidationError[],
  ): string {
    const messages: string[] = [];
    const collect = (
      errs: import('class-validator').ValidationError[],
      prefix: string,
    ): void => {
      for (const err of errs) {
        const path = prefix ? `${prefix}.${err.property}` : err.property;
        if (err.constraints) {
          messages.push(...Object.values(err.constraints));
        }
        if (err.children?.length) collect(err.children, path);
      }
    };
    collect(errors, '');
    return messages.length ? messages.join('; ') : 'Row failed validation';
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
   * to `isActive`; `branchId` restricts to panels scoped to that branch. Each row
   * is enriched with the active branch's assigned Lab Test List / Lab Panel List
   * (bulk-resolved in a fixed number of extra queries, never per-row).
   * @param tenantId tenant scope
   * @param activeBranchId caller's active branch (from JWT); used to resolve the
   *   Lab Test/Panel List assignment, distinct from the `branchId` query filter
   * @param query pagination + optional `search` (panel name / panel code),
   *   `clientType`, `status`, and `branchId` filters
   */
  async findAll(
    tenantId: string,
    activeBranchId: string | null,
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
    const assignments =
      await this.listAssignmentService.getAssignmentsWithListNames(
        tenantId,
        activeBranchId,
        ReferralType.PANEL,
        rows.map((r) => r.id),
      );
    const activeIds = await this.referralUsage.findActiveReferralIds(
      tenantId,
      'referralPanelId',
      rows.map((r) => r.id),
    );
    const data: ReferralPanelListItem[] = rows.map((r) => ({
      ...r,
      labTestList: assignments.get(r.id)?.labTestList ?? null,
      labPanelList: assignments.get(r.id)?.labPanelList ?? null,
      hasActiveOrder: activeIds.has(r.id),
    }));
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
    if (
      await this.referralUsage.hasActiveOrder(tenantId, 'referralPanelId', id)
    ) {
      throw new ReferralPanelInUseException(id);
    }
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
