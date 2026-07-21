import { IsDateString, IsOptional, Matches } from 'class-validator';

/** 24-hour `HH:mm` clock time, e.g. `08:30`, `17:00`. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A one-off override of the schedule for a specific date. Omitting both
 * `startTime` and `endTime` marks the date as a day off (no slots); supplying
 * both replaces the recurring window for that date.
 */
export class ScheduleOverrideDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'startTime must be a 24h HH:mm time' })
  startTime?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'endTime must be a 24h HH:mm time' })
  endTime?: string;
}
