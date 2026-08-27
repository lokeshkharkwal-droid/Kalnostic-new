import { Injectable } from '@nestjs/common';
import {
  ExternalIdFormat,
  PaymentMode,
  RegistrationSetting,
  RepeatIntervalUnit,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { BranchService } from '../branch/branch.service';
import { SaveRegistrationSettingsDto } from './dto/save-registration-settings.dto';
import { ConflictingDiscountModeException } from './exceptions/registration-settings.exceptions';

export interface RegistrationSettingsEnums {
  defaultPaymentModes: PaymentMode[];
  quotationValidityUnits: RepeatIntervalUnit[];
  externalIdFormats: ExternalIdFormat[];
}

/**
 * Per-branch Registration settings (LIMS Settings doc "Registration Module"
 * section). Tenant-scoped **and** branch-level (CLAUDE.md §4.7): every query
 * carries `tenantId` + `branchId`. The row is created on first access so the
 * frontend always receives a complete settings object. ID-generation config
 * (Order/Quotation/Appointment/Patient-UMID) is a separate sibling table —
 * see `RegistrationIdSequenceService`.
 */
@Injectable()
export class RegistrationSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Fetch the active branch's Registration settings, creating defaults on
   * first access.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async getForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<RegistrationSetting> {
    await this.branchService.findById(branchId, tenantId);
    return this.prisma.registrationSetting.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId },
      update: {},
    });
  }

  /**
   * Fetch the tenant-level ("business") Registration settings — the single row
   * with `branchId = null` — creating defaults on first access. This is the
   * business-wide baseline a Business Admin edits; branches that have not
   * customised their own row fall back to it (see {@link getResolvedForBranch}).
   *
   * The composite `tenantId_branchId` upsert can't target a null branch, so this
   * uses findFirst + create.
   */
  async getTenantLevel(tenantId: string): Promise<RegistrationSetting> {
    const existing = await this.prisma.registrationSetting.findFirst({
      where: { tenantId, branchId: null, deletedAt: null },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.registrationSetting.create({
      data: { tenantId, branchId: null },
    });
  }

  /**
   * The **effective** Registration settings for a branch: the branch's own row
   * if it has one, otherwise the tenant-level ("business") row. Unlike
   * {@link getForBranch}, this does NOT auto-create a branch row, so an
   * uncustomised branch genuinely inherits the business settings.
   */
  async getResolvedForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<RegistrationSetting> {
    await this.branchService.findById(branchId, tenantId);
    const branchRow = await this.prisma.registrationSetting.findFirst({
      where: { tenantId, branchId, deletedAt: null },
    });
    return branchRow ?? this.getTenantLevel(tenantId);
  }

  /**
   * Save (partial patch, upsert semantics) the active branch's Registration
   * settings after validating the min/max threshold pairs and the
   * mutually-exclusive discount-mode rule.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   * @throws ValidationException if a min/max threshold pair is inverted
   * @throws ConflictingDiscountModeException if more than one discount mode
   *   would be enabled at once
   */
  async saveForBranch(
    tenantId: string,
    branchId: string,
    dto: SaveRegistrationSettingsDto,
  ): Promise<RegistrationSetting> {
    await this.branchService.findById(branchId, tenantId);
    const existing = await this.prisma.registrationSetting.findUnique({
      where: { tenantId_branchId: { tenantId, branchId } },
    });

    const patch = this.applyAppointmentPaymentExclusivity(dto);
    const effective = { ...(existing ?? {}), ...patch };
    this.validateThresholdRanges(effective);
    this.validateDiscountModeExclusivity(effective);

    return this.prisma.registrationSetting.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId, ...patch },
      update: { ...patch },
    });
  }

  /**
   * Save (partial patch) the tenant-level ("business") Registration settings —
   * the `branchId = null` row a Business Admin edits. Same validation as
   * {@link saveForBranch}; uses findFirst + create/update since the composite
   * upsert can't target a null branch.
   */
  async saveTenantLevel(
    tenantId: string,
    dto: SaveRegistrationSettingsDto,
  ): Promise<RegistrationSetting> {
    const existing = await this.prisma.registrationSetting.findFirst({
      where: { tenantId, branchId: null, deletedAt: null },
    });

    const patch = this.applyAppointmentPaymentExclusivity(dto);
    const effective = { ...(existing ?? {}), ...patch };
    this.validateThresholdRanges(effective);
    this.validateDiscountModeExclusivity(effective);

    if (existing) {
      return this.prisma.registrationSetting.update({
        where: { id: existing.id },
        data: { ...patch },
      });
    }
    return this.prisma.registrationSetting.create({
      data: { tenantId, branchId: null, ...patch },
    });
  }

  /**
   * `Appointment_AllowCheckInForPaidAppointmentsOnly` and
   * `Appointment_AllowProgressOfUnpaidAndPartialPaidAppointments` are mutually
   * exclusive per the spec — enabling one **auto-disables** the other so the
   * saved row is always a valid combination. Returns a patch with the
   * counterpart forced `false`; check-in-for-paid takes precedence if a single
   * request sets both true.
   */
  private applyAppointmentPaymentExclusivity(
    dto: SaveRegistrationSettingsDto,
  ): SaveRegistrationSettingsDto {
    if (dto.Appointment_AllowCheckInForPaidAppointmentsOnly === true) {
      return {
        ...dto,
        Appointment_AllowProgressOfUnpaidAndPartialPaidAppointments: false,
      };
    }
    if (
      dto.Appointment_AllowProgressOfUnpaidAndPartialPaidAppointments === true
    ) {
      return {
        ...dto,
        Appointment_AllowCheckInForPaidAppointmentsOnly: false,
      };
    }
    return dto;
  }

  /** Enum values exposed for frontend select controls. */
  getEnums(): RegistrationSettingsEnums {
    return {
      defaultPaymentModes: Object.values(PaymentMode),
      quotationValidityUnits: Object.values(RepeatIntervalUnit),
      externalIdFormats: Object.values(ExternalIdFormat),
    };
  }

  /** Reject any min-percent field greater than its paired max-percent field. */
  private validateThresholdRanges(effective: {
    ChargesAndDeductions_MinimumTdsPercent?: number;
    ChargesAndDeductions_MaximumTdsPercent?: number;
    ChargesAndDeductions_MinimumDiscountPercent?: number;
    ChargesAndDeductions_MaximumDiscountPercent?: number;
    ChargesAndDeductions_MinimumLineItemDiscountPercent?: number;
    ChargesAndDeductions_MaximumLineItemDiscountPercent?: number;
  }): void {
    const pairs: Array<[string, number | undefined, number | undefined]> = [
      [
        'TDS',
        effective.ChargesAndDeductions_MinimumTdsPercent,
        effective.ChargesAndDeductions_MaximumTdsPercent,
      ],
      [
        'discount',
        effective.ChargesAndDeductions_MinimumDiscountPercent,
        effective.ChargesAndDeductions_MaximumDiscountPercent,
      ],
      [
        'line item discount',
        effective.ChargesAndDeductions_MinimumLineItemDiscountPercent,
        effective.ChargesAndDeductions_MaximumLineItemDiscountPercent,
      ],
    ];
    for (const [label, min, max] of pairs) {
      if (min !== undefined && max !== undefined && min > max) {
        throw new ValidationException(
          `Minimum ${label} percent cannot exceed maximum ${label} percent`,
          { min: String(min), max: String(max) },
        );
      }
    }
  }

  /**
   * `ChargesAndDeductions_AllowOrderDiscountOnly` /
   * `AllowLineDiscountOnly` / `AllowBothOrderAndLineDiscount` are mutually
   * exclusive per the LIMS Settings doc — at most one may be true.
   */
  private validateDiscountModeExclusivity(effective: {
    ChargesAndDeductions_AllowOrderDiscountOnly?: boolean;
    ChargesAndDeductions_AllowLineDiscountOnly?: boolean;
    ChargesAndDeductions_AllowBothOrderAndLineDiscount?: boolean;
  }): void {
    const enabledCount = [
      effective.ChargesAndDeductions_AllowOrderDiscountOnly,
      effective.ChargesAndDeductions_AllowLineDiscountOnly,
      effective.ChargesAndDeductions_AllowBothOrderAndLineDiscount,
    ].filter(Boolean).length;
    if (enabledCount > 1) {
      throw new ConflictingDiscountModeException();
    }
  }
}
