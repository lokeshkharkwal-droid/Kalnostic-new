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
 * Body for creating a referral doctor. `tenantId` is never accepted from the
 * client — the tenant comes from the JWT (CLAUDE.md §4.7). Derived fields
 * (`fullName`, `age`, per-experience `duration`) are computed server-side and not
 * accepted here. Classification ids (`departmentId`/`categoryId`/`subCategoryId`)
 * are validated against the caller's tenant in `ReferralDoctorService`.
 * Commission/bonus configuration is conditional: the `@ValidateIf` rules below are
 * mirrored by the authoritative cross-field checks in the service (which also
 * normalises the stored data). `labTestIds`/`labPanelIds` reference active lab
 * tests/panels in the tenant (validated in the service).
 */
export class CreateReferralDoctorDto {
  // ── Personal details ──
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  firstName: string;

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
  @MinLength(1)
  @MaxLength(20)
  mobileNumber: string;

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

  // ── Practice/location details ──
  @IsString()
  @IsOptional()
  @MaxLength(255)
  hospitalName?: string;

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

  // ── Professional details (classification validated against the tenant) ──
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

  // ── Qualifications & experience (repeatable rows) ──
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
  @ValidateIf((o: CreateReferralDoctorDto) => o.isCommissionApplicable === true)
  @IsEnum(CommissionType)
  commissionType?: CommissionType;

  // Relevant only for PERCENTAGE commission.
  @ValidateIf(
    (o: CreateReferralDoctorDto) =>
      o.commissionType === CommissionType.PERCENTAGE,
  )
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPctLabTest?: number;

  @ValidateIf(
    (o: CreateReferralDoctorDto) =>
      o.commissionType === CommissionType.PERCENTAGE,
  )
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPctLabPanel?: number;

  // Required (non-empty) for SLAB_BASED commission.
  @ValidateIf(
    (o: CreateReferralDoctorDto) =>
      o.commissionType === CommissionType.SLAB_BASED,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CommissionSlabDto)
  commissionSlabs?: CommissionSlabDto[];

  // Required for FIXED_AMOUNT commission (the "Fixed Type").
  @ValidateIf(
    (o: CreateReferralDoctorDto) =>
      o.commissionType === CommissionType.FIXED_AMOUNT,
  )
  @IsEnum(FixedCommissionCycle)
  fixedCommissionCycle?: FixedCommissionCycle;

  // Required for a FIXED_AMOUNT commission on any cycle other than ORDER_WISE.
  @ValidateIf(
    (o: CreateReferralDoctorDto) =>
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
    (o: CreateReferralDoctorDto) => o.isIncentiveBonusApplicable === true,
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

  // ── Status ──
  @IsEnum(ReferralDoctorStatus)
  @IsOptional()
  status?: ReferralDoctorStatus;
}
