import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const CONSOLE_ORDER_MODES = [
  'Walk-in',
  'Home Visit',
  'Online',
  'Referral',
] as const;

export const CONSOLE_PRIORITIES = ['Routine', 'Urgent', 'STAT'] as const;

/**
 * Save/upsert payload for Registration console settings. All fields are
 * optional so the frontend can patch a single card or submit the whole form.
 */
export class SaveConsoleSettingsDto {
  @IsOptional()
  @IsIn(CONSOLE_ORDER_MODES)
  defaultOrderMode?: (typeof CONSOLE_ORDER_MODES)[number];

  @IsOptional()
  @IsIn(CONSOLE_PRIORITIES)
  defaultPriority?: (typeof CONSOLE_PRIORITIES)[number];

  @IsOptional()
  @IsBoolean()
  isEditTestsAfterCollectionAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  isBarcodeRequiredBeforeAcceptance?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  routineWarningHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  routineBreachHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  urgentWarningHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  urgentBreachHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  statWarningHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  statBreachHours?: number;

  @IsOptional()
  @IsBoolean()
  isAudioChimeOnNewOrderEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isAutoPrintLabelsOnSaveEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isOutsourceStationInQueueVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  isBreachedTatHighlightEnabled?: boolean;
}
