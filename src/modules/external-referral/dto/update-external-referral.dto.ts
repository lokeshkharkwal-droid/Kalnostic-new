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
 * Body for updating an external referral. All fields are optional (explicit, not
 * PartialType per SKILL.md §4). Each field is type-validated when present; the
 * cross-field commission/bonus invariants are enforced authoritatively in
 * `ExternalReferralService` against the merged (existing + patch) state.
 * `labTestIds`/`labPanelIds` are replace-all when present (omit to leave that set
 * unchanged).
 */
export class UpdateExternalReferralDto {
  // ── Basic details ──
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

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

  // ── Lab lists (replace-all when present) ──
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

  // ── Commission & TDS (cross-field rules enforced in the service) ──
  @IsBoolean()
  @IsOptional()
  isCommissionApplicable?: boolean;

  @IsEnum(CommissionType)
  @IsOptional()
  commissionType?: CommissionType;

  // Relevant only when this same PATCH also sets Commission Type = PERCENTAGE.
  // (Cannot see the existing row's type here — the authoritative check against
  // the merged/effective state happens in the service's assertCommission.)
  @ValidateIf(
    (o: UpdateExternalReferralDto) =>
      o.commissionType === CommissionType.PERCENTAGE,
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  commissionPctLabTest?: number;

  @ValidateIf(
    (o: UpdateExternalReferralDto) =>
      o.commissionType === CommissionType.PERCENTAGE,
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  commissionPctLabPanel?: number;

  @ValidateIf(
    (o: UpdateExternalReferralDto) =>
      o.commissionType === CommissionType.SLAB_BASED,
  )
  @IsArray()
  @IsOptional()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CommissionSlabDto)
  commissionSlabs?: CommissionSlabDto[];

  @IsEnum(FixedCommissionCycle)
  @IsOptional()
  fixedCommissionCycle?: FixedCommissionCycle;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
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

  @IsArray()
  @IsOptional()
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
