import {
  AccessionBarcodeResetCycle,
  AccessionBarcodeSeparator,
} from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Save (partial patch) per-branch Accession Module Settings (LIMS Settings
 * Master — Accession Module). Every field is optional; omitted master-data
 * lists are merged with the branch's previously-saved values (falling back to
 * `DEFAULT_ACCESSION_SETTINGS` for anything never saved), and omitted typed
 * columns keep their current stored value. Field names follow the project's
 * `HeadingName_SettingName` convention: `MasterData_*` (persisted inside
 * `AccessionSetting.config` JSON), `SampleBarcodeSettings_*` and
 * `Accession_*` (native typed columns).
 */
export class SaveAccessionSettingsDto {
  // ── Master Data ──

  /** Collection tube / sample types (Collect modal). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  MasterData_TubeTypes?: string[];

  /** Sample-condition options (Accept / Receive modals). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  MasterData_SampleConditions?: string[];

  /** Repeat reasons (Repeat modal). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  MasterData_RepeatReasons?: string[];

  /** Error reasons (pre/post-analytical error logging). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  MasterData_ErrorReasons?: string[];

  /** Hold reasons (placing a sample/order on hold). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  MasterData_HoldReasons?: string[];

  /** Discard methods (Discard modal). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  MasterData_DiscardMethods?: string[];

  /** Rejection reasons (transfer Reject modal — Internal/External Referral & Outsource). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  MasterData_RejectionReasons?: string[];

  /** Logistics types (Send / Forward / Outsource modals). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  MasterData_LogisticsTypes?: string[];

  // ── Sample Barcode Settings ──

  @IsOptional()
  @IsString()
  @MaxLength(24)
  @Matches(/^[A-Za-z0-9]*$/, {
    message: 'SampleBarcodeSettings_Prefix may only contain letters and digits',
  })
  SampleBarcodeSettings_Prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  @Matches(/^[A-Za-z0-9]*$/, {
    message: 'SampleBarcodeSettings_Suffix may only contain letters and digits',
  })
  SampleBarcodeSettings_Suffix?: string;

  @IsOptional()
  @IsEnum(AccessionBarcodeSeparator)
  SampleBarcodeSettings_Separator?: AccessionBarcodeSeparator;

  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(10)
  SampleBarcodeSettings_NumberLength?: number;

  @IsOptional()
  @IsEnum(AccessionBarcodeResetCycle)
  SampleBarcodeSettings_ResetInterval?: AccessionBarcodeResetCycle;

  // ── Accession (TAT / acceptance-window / barcode-mapping toggles) ──

  @IsOptional()
  @IsInt()
  @Min(0)
  Accession_MinimumTimeToAcceptSampleMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  Accession_MaximumTimeToAcceptSampleMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  Accession_WarningThresholdMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  Accession_CriticalThresholdMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  Accession_InternalReferralAcceptanceThresholdMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  Accession_ExternalReferralAcceptanceThresholdMinutes?: number;

  @IsOptional()
  @IsBoolean()
  Accession_AllowSampleBarcodeMappingBeforeAcceptInhouseOrders?: boolean;

  @IsOptional()
  @IsBoolean()
  Accession_AllowSampleBarcodeMappingBeforeAcceptInternalReferralOrders?: boolean;

  @IsOptional()
  @IsBoolean()
  Accession_AllowSampleBarcodeMappingBeforeAcceptExternalReferralOrders?: boolean;

  @IsOptional()
  @IsBoolean()
  Accession_AllowSampleBarcodeMappingAfterAcceptInhouseOrders?: boolean;

  @IsOptional()
  @IsBoolean()
  Accession_AllowSampleBarcodeMappingAfterAcceptInternalReferralOrders?: boolean;

  @IsOptional()
  @IsBoolean()
  Accession_AllowSampleBarcodeMappingAfterAcceptExternalReferralOrders?: boolean;

  @IsOptional()
  @IsBoolean()
  Accession_AllowSampleBarcodeMappingForOutsourceOrders?: boolean;
}
