/**
 * Default per-branch appointment settings (Registration › Appointment
 * Settings page). Mirrors the `AccessionSetting` / `OrderFieldConfig` pattern:
 * settings are held per branch as JSON, but a branch with no saved
 * `AppointmentSetting` row falls back to these defaults at read time (see
 * `AppointmentSettingsService`) — so no per-branch seeding is required.
 */
export interface AppointmentSettingsMap {
  /** Default appointment slot length, in minutes. */
  slotDurationMinutes: number;
  /** Gap enforced between consecutive slots, in minutes. */
  bufferMinutes: number;
  /** Maximum walk-in appointments accepted per day. */
  maxWalkInsPerDay: number;
  /** Maximum online bookings accepted per slot. */
  maxOnlineBookingsPerSlot: number;
  /** Branch opening time, `HH:mm` (24h). */
  openTime: string;
  /** Branch closing time, `HH:mm` (24h). */
  closeTime: string;
  /** Weekly off-day policy. */
  weeklyOff: 'None' | 'Sunday' | 'Saturday & Sunday';
  /** Free-text lunch-break window, e.g. `13:00 - 14:00`. */
  lunchBreak: string;
  /** Send an SMS reminder 24h before the appointment. */
  isSmsReminder24hEnabled: boolean;
  /** Send a WhatsApp reminder 2h before the appointment. */
  isWhatsappReminder2hEnabled: boolean;
  /** Send an email confirmation immediately on booking. */
  isEmailConfirmationEnabled: boolean;
  /** Place a voice call for STAT (urgent) bookings. */
  isVoiceCallForStatEnabled: boolean;
  /** Grace period after the slot time before marking a no-show, in minutes. */
  noShowGraceMinutes: number;
  /** Cut-off before the slot after which cancellation is blocked, in hours. */
  cancellationCutoffHours: number;
  /** Automatically cancel the appointment once the no-show grace expires. */
  isAutoCancelAfterGraceEnabled: boolean;
  /** Charge a no-show fee when a patient doesn't show up. */
  isNoShowFeeChargeEnabled: boolean;
}

/** The out-of-the-box appointment settings a branch uses until it saves its own. */
export const DEFAULT_APPOINTMENT_SETTINGS: AppointmentSettingsMap = {
  slotDurationMinutes: 15,
  bufferMinutes: 5,
  maxWalkInsPerDay: 40,
  maxOnlineBookingsPerSlot: 2,
  openTime: '08:00',
  closeTime: '20:00',
  weeklyOff: 'Sunday',
  lunchBreak: '13:00 - 14:00',
  isSmsReminder24hEnabled: true,
  isWhatsappReminder2hEnabled: true,
  isEmailConfirmationEnabled: true,
  isVoiceCallForStatEnabled: false,
  noShowGraceMinutes: 20,
  cancellationCutoffHours: 2,
  isAutoCancelAfterGraceEnabled: true,
  isNoShowFeeChargeEnabled: false,
};
