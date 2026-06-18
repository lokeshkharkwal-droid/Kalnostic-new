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
  ValidateNested,
} from 'class-validator';
import {
  CommissionType,
  FixedCommissionCycle,
  PaymentCycle,
  ReferralClientType,
  ReferralPaymentMode,
} from '@prisma/client';
import { CommissionSlabDto } from './commission-slab.dto';
import { BonusSlabDto } from './bonus-slab.dto';

/**
 * Body for updating a referral panel. All fields are optional (explicit, not
 * PartialType per SKILL.md §4). `code` is immutable and never accepted. Each field
 * is type-validated when present; the cross-field commission/bonus invariants are
 * enforced authoritatively in `ReferralPanelService` against the merged (existing +
 * patch) state. `labTestIds`/`labPanelIds` are replace-all when present (omit to
 * leave the assigned set unchanged) and left untouched when absent.
 */
export class UpdateReferralPanelDto {
  // ── Basic details ──
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  shortName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  panelCode?: string;

  @IsEnum(ReferralClientType)
  @IsOptional()
  clientType?: ReferralClientType;

  /** Optional branch this referral panel belongs to (validated against the tenant in the service). */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  referralPanelSettingsId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // ── Address details ──
  @IsString()
  @IsOptional()
  @MaxLength(255)
  addressLine1?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  addressLine2?: string;

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

  @IsString()
  @IsOptional()
  @MaxLength(50)
  gstNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  panNumber?: string;

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

  // ── Contact persons (flat, one trio per fixed role) ──
  @IsString()
  @IsOptional()
  @MaxLength(255)
  directorName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  directorMobile?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  directorEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  accessionPersonName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  accessionPersonMobile?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  accessionPersonEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  registrationPersonName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  registrationPersonMobile?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  registrationPersonEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  logisticsPersonName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  logisticsPersonMobile?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  logisticsPersonEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  accountsPersonName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  accountsPersonMobile?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  accountsPersonEmail?: string;

  // ── Commission & TDS (cross-field rules enforced in the service) ──
  @IsBoolean()
  @IsOptional()
  isCommissionApplicable?: boolean;

  @IsEnum(CommissionType)
  @IsOptional()
  commissionType?: CommissionType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  commissionPctLabTest?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  commissionPctLabPanel?: number;

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
}
