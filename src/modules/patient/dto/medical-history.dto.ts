import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Rich, display-oriented medical history persisted in the `richHistory` JSON
 * column and shared verbatim by the Registration Create and Patient Details
 * pages (so both render identical data). The top-level shape is validated;
 * `noFlags` and `entries` are kept as opaque objects on purpose — their inner
 * per-category free-form fields (since-year, packs/day, severity, occupation…)
 * differ by category and are the frontend's contract, not the backend's.
 */
export class RichMedicalHistoryDto {
  /** Per-category "no history / not applicable" flags, keyed by category. */
  @IsObject()
  @IsOptional()
  noFlags?: Record<string, boolean>;

  /** Per-category arrays of free-form entry field-maps, keyed by category. */
  @IsObject()
  @IsOptional()
  entries?: Record<string, Array<Record<string, string>>>;

  /** Selected symptom labels (checklist). */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  symptoms?: string[];

  /** Free-text current medications. */
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  currentMedications?: string;
}

/**
 * A medical-history record for a patient. Used both as the body of
 * `POST /patients/:patientId/medical-history` and as a nested item on
 * `CreatePatientDto.medicalHistories`. Every clinical flag is optional and
 * defaults to `false` in the database; the free-text notes are optional.
 * `tenantId`/`branchId`/`patientId` are never accepted here — they come from
 * the request context / route (CLAUDE.md §4.7).
 */
export class MedicalHistoryDto {
  // ── Smoking & alcohol status ──
  @IsBoolean()
  @IsOptional()
  isCurrentSmoker?: boolean;

  @IsBoolean()
  @IsOptional()
  isFormerSmoker?: boolean;

  @IsBoolean()
  @IsOptional()
  isCurrentAlcoholic?: boolean;

  @IsBoolean()
  @IsOptional()
  isFormerAlcoholic?: boolean;

  // ── Symptoms ──
  @IsBoolean()
  @IsOptional()
  hasCough?: boolean;

  @IsBoolean()
  @IsOptional()
  hasFever?: boolean;

  @IsBoolean()
  @IsOptional()
  hasShortnessOfBreath?: boolean;

  @IsBoolean()
  @IsOptional()
  hasChestPain?: boolean;

  @IsBoolean()
  @IsOptional()
  hasAbdominalPain?: boolean;

  @IsBoolean()
  @IsOptional()
  hasHeadache?: boolean;

  @IsBoolean()
  @IsOptional()
  hasVomiting?: boolean;

  @IsBoolean()
  @IsOptional()
  hasDiarrhea?: boolean;

  @IsBoolean()
  @IsOptional()
  hasFatigue?: boolean;

  @IsBoolean()
  @IsOptional()
  hasWeightLoss?: boolean;

  @IsBoolean()
  @IsOptional()
  hasBodyPains?: boolean;

  @IsBoolean()
  @IsOptional()
  hasDizziness?: boolean;

  // ── Medical conditions ──
  @IsBoolean()
  @IsOptional()
  hasDiabetes?: boolean;

  @IsBoolean()
  @IsOptional()
  hasHypertension?: boolean;

  @IsBoolean()
  @IsOptional()
  hasCardiacDisease?: boolean;

  @IsBoolean()
  @IsOptional()
  hasThyroidDisease?: boolean;

  @IsBoolean()
  @IsOptional()
  hasKidneyDisease?: boolean;

  // ── Medications ──
  @IsBoolean()
  @IsOptional()
  hasAntiDiabeticDrugs?: boolean;

  @IsBoolean()
  @IsOptional()
  hasAntiHypertensionDrugs?: boolean;

  @IsBoolean()
  @IsOptional()
  hasBloodThinners?: boolean;

  @IsBoolean()
  @IsOptional()
  hasVitaminSupplements?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  otherMedications?: string;

  // ── Allergies ──
  @IsBoolean()
  @IsOptional()
  hasLatexAllergy?: boolean;

  @IsBoolean()
  @IsOptional()
  hasFoodAllergy?: boolean;

  @IsBoolean()
  @IsOptional()
  hasDrugAllergy?: boolean;

  // ── Additional information ──
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  surgicalHistory?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  remarks?: string;

  // ── Rich, display-oriented history (source of truth for the UI) ──
  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => RichMedicalHistoryDto)
  richHistory?: RichMedicalHistoryDto;
}
