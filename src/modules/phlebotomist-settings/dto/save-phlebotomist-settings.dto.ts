import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Allowed values for `autoAssignStrategy`. */
export const AUTO_ASSIGN_STRATEGIES = [
  'Nearest first',
  'Round-robin',
  'Manual',
] as const;

/**
 * Save per-branch phlebotomist settings (Registration › Phlebotomist
 * Settings). Every field is optional (a partial patch); omitted fields fall
 * back to `DEFAULT_PHLEBOTOMIST_SETTINGS` at read time. Validated by
 * `class-validator` only; persisted as the branch's `PhlebotomistSetting.config`
 * JSON.
 */
export class SavePhlebotomistSettingsDto {
  /** Strategy used to auto-assign a phlebotomist to a collection request. */
  @IsOptional()
  @IsIn(AUTO_ASSIGN_STRATEGIES)
  autoAssignStrategy?: (typeof AUTO_ASSIGN_STRATEGIES)[number];

  /** Maximum home-visit collections assigned to one phlebotomist per day (1-100). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxVisitsPerPhleboPerDay?: number;

  /** Default home-visit service radius from the branch, in km (0-500). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(500)
  defaultServiceRadiusKm?: number;

  /** Allow the patient to pick a specific phlebotomist for their visit. */
  @IsOptional()
  @IsBoolean()
  isPatientPickPhleboAllowed?: boolean;

  /** Default kit items issued for a collection visit (free text, max 500 chars). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  defaultKitItems?: string;

  /** Minimum acceptable cold-chain storage temperature, in °C (-20 to 50). */
  @IsOptional()
  @IsInt()
  @Min(-20)
  @Max(50)
  minColdChainTempC?: number;

  /** Maximum acceptable cold-chain storage temperature, in °C (-20 to 50). */
  @IsOptional()
  @IsInt()
  @Min(-20)
  @Max(50)
  maxColdChainTempC?: number;

  /** Require a photo of the sample at the point of pickup. */
  @IsOptional()
  @IsBoolean()
  isPhotoOfSampleAtPickupRequired?: boolean;

  /** Capture a geo-tag when the sample is collected. */
  @IsOptional()
  @IsBoolean()
  isGeoTagCaptureOnCollectionEnabled?: boolean;

  /** Phlebotomist shift start time, `HH:mm` (24h). */
  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN, { message: 'shiftStart must be in HH:mm 24h format' })
  shiftStart?: string;

  /** Phlebotomist shift end time, `HH:mm` (24h). */
  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN, { message: 'shiftEnd must be in HH:mm 24h format' })
  shiftEnd?: string;

  /** SLA for reaching the patient after a pickup request, in minutes (1-1440). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  pickupSlaMinutes?: number;

  /** SLA for dropping the sample back at the branch/lab, in hours (0-72). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(72)
  dropBackSlaHours?: number;

  /** Alert the branch manager whenever an SLA is breached. */
  @IsOptional()
  @IsBoolean()
  isManagerAlertOnSlaBreachEnabled?: boolean;
}
