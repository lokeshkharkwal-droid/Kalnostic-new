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
  ValidateNested,
} from 'class-validator';
import {
  CommissionType,
  FixedCommissionCycle,
  Gender,
  PaymentCycle,
  ReferralDoctorStatus,
  ReferralPaymentMode,
} from '@prisma/client';
import { CommissionSlabDto } from './commission-slab.dto';
import { BonusSlabDto } from './bonus-slab.dto';
import { ReferralDoctorQualificationDto } from './referral-doctor-qualification.dto';
import { ReferralDoctorExperienceDto } from './referral-doctor-experience.dto';

/**
 * Body for updating a referral doctor. All fields are optional (explicit, not
 * PartialType per SKILL.md §4). Each field is type-validated when present; the
 * cross-field commission/bonus invariants are enforced authoritatively in
 * `ReferralDoctorService` against the merged (existing + patch) state.
 * `qualifications`/`experiences`/`labTestIds`/`labPanelIds` are replace-all when
 * present (omit to leave that set unchanged).
 */
export class UpdateReferralDoctorDto {
  // ── Personal details ──
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  middleName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  lastName?: string;

  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(20)
  mobileNumber?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  aadhaarNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  panNumber?: string;

  // ── Professional details ──
  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  subCategoryId?: string;

  /** Optional branch this referral doctor belongs to (validated against the tenant in the service). */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  /** Ref to a ReferralPanelSettings template in the tenant (validated in the service). */
  @IsUUID()
  @IsOptional()
  referralPanelSettingsId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  medicalLicenseNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  registrationCouncil?: string;

  @IsDateString()
  @IsOptional()
  registrationValidTill?: string;

  // ── Qualifications & experience (replace-all when present) ──
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ReferralDoctorQualificationDto)
  qualifications?: ReferralDoctorQualificationDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ReferralDoctorExperienceDto)
  experiences?: ReferralDoctorExperienceDto[];

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

  // ── Status ──
  @IsEnum(ReferralDoctorStatus)
  @IsOptional()
  status?: ReferralDoctorStatus;
}
