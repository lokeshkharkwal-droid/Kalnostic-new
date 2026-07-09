import { PgCommissionType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

/**
 * Editable Business Settings fields (referral / payment / commission / wallet
 * rules). All optional — drives an upsert, so a partial payload patches only the
 * supplied fields. Booleans keep the mandated is/can prefix (CLAUDE.md §3).
 */
export class UpdateTenantSettingsDto {
  // ── Referral settings ──
  @IsBoolean()
  @IsOptional()
  isExternalDoctorOutReferralAllowed?: boolean;

  @IsBoolean()
  @IsOptional()
  isExternalDoctorInReferralAllowed?: boolean;

  @IsBoolean()
  @IsOptional()
  isExternalHospitalOutReferralAllowed?: boolean;

  @IsBoolean()
  @IsOptional()
  isExternalHospitalInReferralAllowed?: boolean;

  // ── Payment settings ──
  @IsBoolean()
  @IsOptional()
  isPatientOrderPaymentAllowed?: boolean;

  @IsBoolean()
  @IsOptional()
  isCmsOrderBillGenerationEnabled?: boolean;

  // ── Commission types (payment gateway) ──
  @IsEnum(PgCommissionType)
  @IsOptional()
  referralPgCommissionType?: PgCommissionType;

  @IsEnum(PgCommissionType)
  @IsOptional()
  patientPgCommissionType?: PgCommissionType;

  @IsEnum(PgCommissionType)
  @IsOptional()
  franchiseBranchPgCommissionType?: PgCommissionType;

  // ── Wallet settings ──
  @IsBoolean()
  @IsOptional()
  canPatientWalletGoNegative?: boolean;
}
