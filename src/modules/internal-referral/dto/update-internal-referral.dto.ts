import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
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
  CommissionMode,
  CommissionType,
  FixedCommissionCycle,
  InternalReferralStatus,
  PaymentCycle,
  ReferralPaymentMode,
} from '@prisma/client';
import { CommissionSlabDto } from './commission-slab.dto';
import { BonusSlabDto } from './bonus-slab.dto';

/**
 * Body for updating an internal referral. All fields are optional (explicit, not
 * PartialType per SKILL.md §4). Each field is type-validated when present; the
 * cross-field commission/bonus invariants are enforced authoritatively in
 * `InternalReferralService` against the merged (existing + patch) state.
 * `labTestIds`/`labPanelIds` are replace-all when present (omit to leave that set
 * unchanged).
 */
export class UpdateInternalReferralDto {
  // ── Employee details ──
  @IsUUID()
  @IsOptional()
  employeeId?: string;

  /** Optional branch this internal referral belongs to (validated against the tenant in the service). */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  /** Ref to a ReferralPanelSettings template in the tenant (validated in the service). */
  @IsUUID()
  @IsOptional()
  referralPanelSettingsId?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  lastName?: string;

  // fullName is never accepted from the client — it's always derived from
  // firstName/lastName in the service (see InternalReferralService.create/update).

  @IsString()
  @IsOptional()
  @MaxLength(255)
  department?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  designation?: string;

  @IsDateString()
  @IsOptional()
  joiningDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  mobileNumber?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  email?: string;

  // ── Location details ──
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
  pincode?: string;

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
    (o: UpdateInternalReferralDto) =>
      o.commissionType === CommissionType.PERCENTAGE,
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  commissionPctLabTest?: number;

  @ValidateIf(
    (o: UpdateInternalReferralDto) =>
      o.commissionType === CommissionType.PERCENTAGE,
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  commissionPctLabPanel?: number;

  @ValidateIf(
    (o: UpdateInternalReferralDto) =>
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

  // ── Payroll & payment ──
  @IsBoolean()
  @IsOptional()
  isIncludedInPayroll?: boolean;

  @IsEnum(PaymentCycle)
  @IsOptional()
  paymentCycle?: PaymentCycle;

  @IsEnum(ReferralPaymentMode)
  @IsOptional()
  paymentMode?: ReferralPaymentMode;

  @IsEnum(CommissionMode)
  @IsOptional()
  commissionMode?: CommissionMode;

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

  // ── Status ──
  @IsEnum(InternalReferralStatus)
  @IsOptional()
  status?: InternalReferralStatus;
}
