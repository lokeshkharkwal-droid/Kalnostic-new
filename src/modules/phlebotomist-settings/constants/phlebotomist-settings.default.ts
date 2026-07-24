/**
 * Default per-branch phlebotomist settings (Registration › Phlebotomist
 * Settings page). Mirrors the `AppointmentSetting` pattern: settings are held
 * per branch as JSON, but a branch with no saved `PhlebotomistSetting` row
 * falls back to these defaults at read time (see `PhlebotomistSettingsService`)
 * — so no per-branch seeding is required.
 */
export interface PhlebotomistSettingsMap {
  /** Strategy used to auto-assign a phlebotomist to a collection request. */
  autoAssignStrategy: 'Nearest first' | 'Round-robin' | 'Manual';
  /** Maximum home-visit collections assigned to one phlebotomist per day. */
  maxVisitsPerPhleboPerDay: number;
  /** Default home-visit service radius from the branch, in kilometres. */
  defaultServiceRadiusKm: number;
  /** Allow the patient to pick a specific phlebotomist for their visit. */
  isPatientPickPhleboAllowed: boolean;
  /** Default kit items issued for a collection visit (free text). */
  defaultKitItems: string;
  /** Minimum acceptable cold-chain storage temperature, in °C. */
  minColdChainTempC: number;
  /** Maximum acceptable cold-chain storage temperature, in °C. */
  maxColdChainTempC: number;
  /** Require a photo of the sample at the point of pickup. */
  isPhotoOfSampleAtPickupRequired: boolean;
  /** Capture a geo-tag when the sample is collected. */
  isGeoTagCaptureOnCollectionEnabled: boolean;
  /** Phlebotomist shift start time, `HH:mm` (24h). */
  shiftStart: string;
  /** Phlebotomist shift end time, `HH:mm` (24h). */
  shiftEnd: string;
  /** SLA for reaching the patient after a pickup request, in minutes. */
  pickupSlaMinutes: number;
  /** SLA for dropping the sample back at the branch/lab, in hours. */
  dropBackSlaHours: number;
  /** Alert the branch manager whenever an SLA is breached. */
  isManagerAlertOnSlaBreachEnabled: boolean;
}

/** The out-of-the-box phlebotomist settings a branch uses until it saves its own. */
export const DEFAULT_PHLEBOTOMIST_SETTINGS: PhlebotomistSettingsMap = {
  autoAssignStrategy: 'Nearest first',
  maxVisitsPerPhleboPerDay: 12,
  defaultServiceRadiusKm: 8,
  isPatientPickPhleboAllowed: false,
  defaultKitItems: 'EDTA x2, Serum x2, Citrate x1, Urine cup x1',
  minColdChainTempC: 2,
  maxColdChainTempC: 8,
  isPhotoOfSampleAtPickupRequired: true,
  isGeoTagCaptureOnCollectionEnabled: true,
  shiftStart: '07:00',
  shiftEnd: '15:00',
  pickupSlaMinutes: 45,
  dropBackSlaHours: 2,
  isManagerAlertOnSlaBreachEnabled: true,
};
