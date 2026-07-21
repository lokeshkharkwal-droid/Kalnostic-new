/**
 * Default per-branch accession settings (PDF §G — configurable dropdowns &
 * thresholds). Mirrors the `OrderFieldConfig` pattern: the settings are held per
 * branch as JSON, but a branch with no saved `AccessionSetting` row falls back to
 * these defaults at read time (see `AccessionSettingsService`, Phase 4) — so no
 * per-branch seeding is required. The Phase-4 Settings UI edits/overrides them.
 *
 * Tube types are seeded from the Collect Sample modal (PDF §A.10.1). All string
 * lists are the sanctioned source for the corresponding action-modal dropdowns;
 * services validate a submitted value against the branch's (possibly overridden)
 * list rather than a hard enum (plan: reason/condition/tube are configurable).
 */
export interface AccessionSettingsMap {
  /** Collection tube / sample types (PDF §A.10.1). */
  tubeTypes: string[];
  /** Sample-condition options recorded on Accept (PDF §A.10.x). */
  sampleConditions: string[];
  /** Reasons offered on the Repeat modal. */
  repeatReasons: string[];
  /** Methods offered on the Discard modal. */
  discardMethods: string[];
  /** Reasons offered on a transfer Reject (PDF Part B). */
  rejectionReasons: string[];
  /** Logistics/handover types for dispatch & transfers. */
  logisticsTypes: string[];
  /** TAT thresholds (minutes) powering the derived Within/Warning/Critical/Breached bar. */
  tat: {
    warningMinutes: number;
    criticalMinutes: number;
    breachedMinutes: number;
  };
}

/** The out-of-the-box accession settings a branch uses until it saves its own. */
export const DEFAULT_ACCESSION_SETTINGS: AccessionSettingsMap = {
  tubeTypes: [
    'SST (Yellow)',
    'EDTA (Purple)',
    'Sodium Citrate (Blue)',
    'Fluoride Oxalate (Grey)',
    'Heparin (Green)',
    'Urine Cup',
    'Swab',
    'Other',
  ],
  sampleConditions: [
    'Good',
    'Hemolyzed',
    'Lipemic',
    'Icteric',
    'Clotted',
    'Insufficient Volume',
    'Leaked / Spilled',
  ],
  repeatReasons: [
    'QC Failure',
    'Sample Quality Issue',
    'Insufficient Volume',
    'Instrument Error',
    'Doctor Request',
  ],
  discardMethods: [
    'Biohazard Bag',
    'Incineration',
    'Autoclave',
    'Sharps Container',
  ],
  rejectionReasons: [
    'Damaged in Transit',
    'Wrong Sample Type',
    'Unlabelled / Mislabelled',
    'Insufficient Volume',
    'Expired / Time Lapsed',
  ],
  logisticsTypes: ['Self', 'Courier', 'Rider', 'Lab Vehicle', 'Third-party'],
  tat: {
    warningMinutes: 240,
    criticalMinutes: 480,
    breachedMinutes: 720,
  },
};
