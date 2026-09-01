import {
  AccessionBarcodeResetCycle,
  AccessionBarcodeSeparator,
} from '@prisma/client';
import { CONTAINER_TYPE_LABEL_LIST } from './container-type.constants';

/**
 * Default per-branch Accession Module master-data lists (LIMS Settings
 * Master — Accession Module). Mirrors the `OrderFieldConfig` pattern: the
 * lists are held per branch as JSON on `AccessionSetting.config`, and a
 * branch with no saved row falls back to these defaults at read time (see
 * `AccessionSettingsService`). The Accession Module Settings UI edits them.
 *
 * All keys follow the project's `HeadingName_SettingName` field convention
 * (heading `MasterData`) even though they live inside a JSON column, so the
 * API response/DTO field names are identical to what's stored.
 *
 * Tube types are seeded from the Collect Sample modal. All string lists are
 * the sanctioned source for the corresponding action-modal dropdowns;
 * services validate a submitted value against the branch's (possibly
 * overridden) list rather than a hard enum.
 */
export interface AccessionSettingsMap {
  /** Collection tube / sample types (Collect modal). */
  MasterData_TubeTypes: string[];
  /** Sample-condition options recorded on Accept/Receive. */
  MasterData_SampleConditions: string[];
  /** Reasons offered on the Repeat modal. */
  MasterData_RepeatReasons: string[];
  /** Reasons offered when logging a pre/post-analytical error. */
  MasterData_ErrorReasons: string[];
  /** Reasons offered when placing a sample/order on hold. */
  MasterData_HoldReasons: string[];
  /** Methods offered on the Discard modal. */
  MasterData_DiscardMethods: string[];
  /** Reasons offered on a transfer Reject (shared by Internal/External Referral & Outsource). */
  MasterData_RejectionReasons: string[];
  /** Logistics/handover types for dispatch & transfers. */
  MasterData_LogisticsTypes: string[];
}

/** The out-of-the-box Accession Module settings a branch uses until it saves its own. */
export const DEFAULT_ACCESSION_SETTINGS: AccessionSettingsMap = {
  // Seeded from the canonical container-type labels so every container a test
  // can be configured with is a selectable tube type here (Collect & Print
  // auto-selects the configured container against this list).
  MasterData_TubeTypes: [...CONTAINER_TYPE_LABEL_LIST],
  MasterData_SampleConditions: [
    'Satisfactory',
    'Hemolyzed',
    'Lipemic',
    'Clotted',
    'Insufficient Volume',
    'Wrong Tube',
    'Unlabelled',
    'Others',
  ],
  MasterData_RepeatReasons: [
    'Insufficient Volume',
    'QC Failure',
    'Clotted Sample',
    'Wrong Tube',
    'Equipment Error',
    'Hemolyzed Sample',
    'Others',
  ],
  MasterData_ErrorReasons: [
    'Pre-Analytical',
    'Analytical',
    'Post-Analytical',
    'Sample Mix-up',
    'Equipment Malfunction',
    'Other',
  ],
  MasterData_HoldReasons: [
    'Awaiting Payment',
    'QC Pending',
    'Calibration Pending',
    'Instrument Breakdown',
    'Other',
  ],
  MasterData_DiscardMethods: [
    'Biohazard Bag',
    'Incineration',
    'Autoclave',
    'Sharps Container',
  ],
  MasterData_RejectionReasons: [
    'Damaged in Transit',
    'Wrong Sample Type',
    'Unlabelled / Mislabelled',
    'Insufficient Volume',
    'Expired / Time Lapsed',
  ],
  MasterData_LogisticsTypes: [
    'Self',
    'Courier',
    'Rider',
    'Lab Vehicle',
    'Third-party',
  ],
};

/**
 * The typed-column shape of `AccessionSetting` (Sample Barcode Settings +
 * Accession TAT/acceptance-window/barcode-mapping settings), i.e. everything
 * on the model except `id`/`tenantId`/`branchId`/`config`/timestamps. Kept as
 * its own type so `AccessionSettingsService` can build an in-memory "no row
 * yet" default (mirroring the Prisma `@default(...)` values below exactly)
 * without a DB round-trip when there's no active branch.
 */
export interface AccessionTypedSettings {
  SampleBarcodeSettings_Prefix: string;
  SampleBarcodeSettings_Suffix: string;
  SampleBarcodeSettings_Separator: AccessionBarcodeSeparator;
  SampleBarcodeSettings_NumberLength: number;
  SampleBarcodeSettings_ResetInterval: AccessionBarcodeResetCycle;
  SampleBarcodeSettings_CurrentNumber: number;
  SampleBarcodeSettings_LastResetAt: Date | null;

  Accession_MinimumTimeToAcceptSampleMinutes: number;
  Accession_MaximumTimeToAcceptSampleMinutes: number;
  Accession_WarningThresholdMinutes: number;
  Accession_CriticalThresholdMinutes: number;
  Accession_InternalReferralAcceptanceThresholdMinutes: number;
  Accession_ExternalReferralAcceptanceThresholdMinutes: number;

  Accession_AllowSampleBarcodeMappingBeforeAcceptInhouseOrders: boolean;
  Accession_AllowSampleBarcodeMappingBeforeAcceptInternalReferralOrders: boolean;
  Accession_AllowSampleBarcodeMappingBeforeAcceptExternalReferralOrders: boolean;
  Accession_AllowSampleBarcodeMappingAfterAcceptInhouseOrders: boolean;
  Accession_AllowSampleBarcodeMappingAfterAcceptInternalReferralOrders: boolean;
  Accession_AllowSampleBarcodeMappingAfterAcceptExternalReferralOrders: boolean;
  Accession_AllowSampleBarcodeMappingForOutsourceOrders: boolean;
}

/** Mirrors the `AccessionSetting` model's Prisma `@default(...)` values — must stay in sync. */
export const DEFAULT_ACCESSION_TYPED_SETTINGS: AccessionTypedSettings = {
  SampleBarcodeSettings_Prefix: '',
  SampleBarcodeSettings_Suffix: '',
  SampleBarcodeSettings_Separator: AccessionBarcodeSeparator.NONE,
  SampleBarcodeSettings_NumberLength: 5,
  SampleBarcodeSettings_ResetInterval: AccessionBarcodeResetCycle.NEVER,
  SampleBarcodeSettings_CurrentNumber: 0,
  SampleBarcodeSettings_LastResetAt: null,

  Accession_MinimumTimeToAcceptSampleMinutes: 10,
  Accession_MaximumTimeToAcceptSampleMinutes: 20,
  Accession_WarningThresholdMinutes: 10,
  Accession_CriticalThresholdMinutes: 5,
  Accession_InternalReferralAcceptanceThresholdMinutes: 60,
  Accession_ExternalReferralAcceptanceThresholdMinutes: 60,

  Accession_AllowSampleBarcodeMappingBeforeAcceptInhouseOrders: true,
  Accession_AllowSampleBarcodeMappingBeforeAcceptInternalReferralOrders: true,
  Accession_AllowSampleBarcodeMappingBeforeAcceptExternalReferralOrders: true,
  Accession_AllowSampleBarcodeMappingAfterAcceptInhouseOrders: true,
  Accession_AllowSampleBarcodeMappingAfterAcceptInternalReferralOrders: true,
  Accession_AllowSampleBarcodeMappingAfterAcceptExternalReferralOrders: true,
  Accession_AllowSampleBarcodeMappingForOutsourceOrders: true,
};
