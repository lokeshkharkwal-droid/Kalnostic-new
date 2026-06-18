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
  FixedCommissionCycle,
  PaymentCycle,
  ReferralClientType,
  ReferralPaymentMode,
} from '@prisma/client';
import { CommissionSlabDto } from './commission-slab.dto';
import { BonusSlabDto } from './bonus-slab.dto';

/**
 * Body for creating a referral panel. `tenantId` and `code` are never accepted
 * from the client — the tenant comes from the JWT and `code` is system-generated
 * (`RP-00001`…). Contact persons are flat fields (one trio per fixed role).
 * Commission/bonus configuration is conditional: the conditional `@ValidateIf`
 * rules below are mirrored by the authoritative cross-field checks in
 * `ReferralPanelService` (which also normalises the stored data). `labTestIds`/
 * `labPanelIds` reference active lab tests/panels in the tenant (validated in the
 * service).
 */
export class CreateReferralPanelDto {
  // ── Basic details ──
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  shortName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  panelCode?: string;

  @IsEnum(ReferralClientType)
  clientType: ReferralClientType;

  /** Optional branch this referral panel belongs to (validated against the tenant in the service). */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  /** Ref to a ReferralPanelSettings template in the tenant (validated in the service). */
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

  // ── Contact persons (flat, one trio per fixed role; all optional) ──
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

  // ── Commission & TDS ──
  @IsBoolean()
  @IsOptional()
  isCommissionApplicable?: boolean;

  // Required when commission is applicable.
  @ValidateIf((o: CreateReferralPanelDto) => o.isCommissionApplicable === true)
  @IsEnum(CommissionType)
  commissionType?: CommissionType;

  // Relevant only for PERCENTAGE commission.
  @ValidateIf(
    (o: CreateReferralPanelDto) =>
      o.commissionType === CommissionType.PERCENTAGE,
  )
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPctLabTest?: number;

  @ValidateIf(
    (o: CreateReferralPanelDto) =>
      o.commissionType === CommissionType.PERCENTAGE,
  )
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPctLabPanel?: number;

  // Required (non-empty) for SLAB_BASED commission.
  @ValidateIf(
    (o: CreateReferralPanelDto) =>
      o.commissionType === CommissionType.SLAB_BASED,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CommissionSlabDto)
  commissionSlabs?: CommissionSlabDto[];

  // Required for FIXED_AMOUNT commission.
  @ValidateIf(
    (o: CreateReferralPanelDto) =>
      o.commissionType === CommissionType.FIXED_AMOUNT,
  )
  @IsEnum(FixedCommissionCycle)
  fixedCommissionCycle?: FixedCommissionCycle;

  // Required for a FIXED_AMOUNT commission on any cycle other than ORDER_WISE.
  @ValidateIf(
    (o: CreateReferralPanelDto) =>
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
    (o: CreateReferralPanelDto) => o.isIncentiveBonusApplicable === true,
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
}
