import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKLY_OFF_VALUES = ['None', 'Sunday', 'Saturday & Sunday'] as const;

/**
 * Save per-branch appointment settings (Registration › Appointment Settings).
 * Every field is optional (a partial patch); omitted fields fall back to
 * `DEFAULT_APPOINTMENT_SETTINGS` at read time. Validated by `class-validator`
 * only; persisted as the branch's `AppointmentSetting.config` JSON.
 */
export class SaveAppointmentSettingsDto {
  /** Default appointment slot length, in minutes (5-240). */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  slotDurationMinutes?: number;

  /** Gap enforced between consecutive slots, in minutes (0-60). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  bufferMinutes?: number;

  /** Maximum walk-in appointments accepted per day (0-1000). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  maxWalkInsPerDay?: number;

  /** Maximum online bookings accepted per slot (0-100). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxOnlineBookingsPerSlot?: number;

  /** Branch opening time, `HH:mm` (24h). */
  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN, { message: 'openTime must be in HH:mm 24h format' })
  openTime?: string;

  /** Branch closing time, `HH:mm` (24h). */
  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN, { message: 'closeTime must be in HH:mm 24h format' })
  closeTime?: string;

  /** Weekly off-day policy. */
  @IsOptional()
  @IsIn(WEEKLY_OFF_VALUES)
  weeklyOff?: (typeof WEEKLY_OFF_VALUES)[number];

  /** Free-text lunch-break window, e.g. `13:00 - 14:00` (max 50 chars). */
  @IsOptional()
  @IsString()
  @Matches(/^.{0,50}$/)
  lunchBreak?: string;

  /** Send an SMS reminder 24h before the appointment. */
  @IsOptional()
  @IsBoolean()
  isSmsReminder24hEnabled?: boolean;

  /** Send a WhatsApp reminder 2h before the appointment. */
  @IsOptional()
  @IsBoolean()
  isWhatsappReminder2hEnabled?: boolean;

  /** Send an email confirmation immediately on booking. */
  @IsOptional()
  @IsBoolean()
  isEmailConfirmationEnabled?: boolean;

  /** Place a voice call for STAT (urgent) bookings. */
  @IsOptional()
  @IsBoolean()
  isVoiceCallForStatEnabled?: boolean;

  /** Grace period after the slot time before marking a no-show, in minutes (0-240). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  noShowGraceMinutes?: number;

  /** Cut-off before the slot after which cancellation is blocked, in hours (0-72). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(72)
  cancellationCutoffHours?: number;

  /** Automatically cancel the appointment once the no-show grace expires. */
  @IsOptional()
  @IsBoolean()
  isAutoCancelAfterGraceEnabled?: boolean;

  /** Charge a no-show fee when a patient doesn't show up. */
  @IsOptional()
  @IsBoolean()
  isNoShowFeeChargeEnabled?: boolean;
}
