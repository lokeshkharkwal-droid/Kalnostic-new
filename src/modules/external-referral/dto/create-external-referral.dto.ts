import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CommissionType,
  ExternalReferralStatus,
  FixedCommissionCycle,
  PaymentCycle,
  ReferralPaymentMode,
} from '@prisma/client';
import { CommissionSlabDto } from './commission-slab.dto';
import { BonusSlabDto } from './bonus-slab.dto';

/**
 * Body for creating an external referral. `tenantId` is never accepted from the
 * client — the tenant comes from the JWT (CLAUDE.md §4.7). Commission/bonus
 * configuration is conditional: the `@ValidateIf` rules below are mirrored by the
 * authoritative cross-field checks in `ExternalReferralService` (which also
 * normalises the stored data). `labTestIds`/`labPanelIds` reference active lab
 * tests/panels in the tenant (validated in the service). The attachment is stored
 * as name + URL; the upload itself is handled elsewhere.
 */
export class CreateExternalReferralDto {
  // ── Basic details ──
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  organisationName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  referralCode?: string;

  @IsEnum(ExternalReferralStatus)
  @IsOptional()
  status?: ExternalReferralStatus;

  /** Optional branch this external referral belongs to (validated against the tenant in the service). */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  /** Ref to a ReferralPanelSettings template in the tenant (validated in the service). */
  @IsUUID()
  @IsOptional()
  referralPanelSettingsId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  mobileNumber?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  email?: string;

  // ── Address & identity ──
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  address?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  city?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  state?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  pinCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  panNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  aadhaarNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  gstNumber?: string;

  // ── Bank details ──
  @IsString()
  @IsOptional()
  @MaxLength(255)
  accountHolderName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  bankName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  accountNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  ifscCode?: string;

  // ── Lab lists (assigned tests/panels; multi-select, optional) ──
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  labTestIds?: string[];

  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  labPanelIds?: string[];

  // ── Commission & TDS ──
  @IsBoolean()
  @IsOptional()
  isCommissionApplicable?: boolean;

  // Required when commission is applicable.
  @ValidateIf(
    (o: CreateExternalReferralDto) => o.isCommissionApplicable === true,
  )
  @IsEnum(CommissionType)
  commissionType?: CommissionType;

  // Relevant only for PERCENTAGE commission.
  @ValidateIf(
    (o: CreateExternalReferralDto) =>
      o.commissionType === CommissionType.PERCENTAGE,
  )
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPctLabTest?: number;

  @ValidateIf(
    (o: CreateExternalReferralDto) =>
      o.commissionType === CommissionType.PERCENTAGE,
  )
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPctLabPanel?: number;

  // Required (non-empty) for SLAB_BASED commission.
  @ValidateIf(
    (o: CreateExternalReferralDto) =>
      o.commissionType === CommissionType.SLAB_BASED,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CommissionSlabDto)
  commissionSlabs?: CommissionSlabDto[];

  // Required for FIXED_AMOUNT commission (the "Fixed Type").
  @ValidateIf(
    (o: CreateExternalReferralDto) =>
      o.commissionType === CommissionType.FIXED_AMOUNT,
  )
  @IsEnum(FixedCommissionCycle)
  fixedCommissionCycle?: FixedCommissionCycle;

  // Required for a FIXED_AMOUNT commission on any cycle other than ORDER_WISE.
  @ValidateIf(
    (o: CreateExternalReferralDto) =>
      o.commissionType === CommissionType.FIXED_AMOUNT &&
      o.fixedCommissionCycle !== undefined &&
      o.fixedCommissionCycle !== FixedCommissionCycle.ORDER_WISE,
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fixedAmount?: number;

  @IsBoolean()
  @IsOptional()
  isTdsApplicable?: boolean;

  // TDS percentage; only meaningful when TDS applies (normalised in the service).
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  tds?: number;

  // ── Payment & incentive ──
  @IsEnum(PaymentCycle)
  @IsOptional()
  paymentCycle?: PaymentCycle;

  @IsEnum(ReferralPaymentMode)
  @IsOptional()
  paymentMode?: ReferralPaymentMode;

  @IsInt()
  @Min(0)
  @IsOptional()
  monthlyTargetAmount?: number;

  @IsBoolean()
  @IsOptional()
  isIncentiveBonusApplicable?: boolean;

  // Required (non-empty) when incentive bonus is applicable.
  @ValidateIf(
    (o: CreateExternalReferralDto) => o.isIncentiveBonusApplicable === true,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BonusSlabDto)
  bonusSlabs?: BonusSlabDto[];

  // ── Attachment & remarks ──
  @IsString()
  @IsOptional()
  @MaxLength(255)
  fileName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  fileUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  remarks?: string;
}
