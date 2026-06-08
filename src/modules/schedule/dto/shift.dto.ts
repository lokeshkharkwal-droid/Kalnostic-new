import { DayOfWeek, ShiftName } from '@prisma/client';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  Matches,
} from 'class-validator';

/** 24-hour `HH:mm` clock time (branch-local), e.g. `08:30`, `22:00`. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A single shift within a schedule. Persisted inside the schedule's `shifts`
 * JSON column (not a separate table). Cross-field rules — break must fall
 * inside the shift window, and shifts must not overlap each other on a shared
 * active day — are enforced in `ScheduleService` (they span multiple fields /
 * the whole array).
 */
export class ShiftDto {
  @IsEnum(ShiftName)
  shiftName: ShiftName;

  @Matches(HH_MM, { message: 'startTime must be a 24h HH:mm time' })
  startTime: string;

  @Matches(HH_MM, { message: 'endTime must be a 24h HH:mm time' })
  endTime: string;

  @Matches(HH_MM, { message: 'breakStartTime must be a 24h HH:mm time' })
  breakStartTime: string;

  @Matches(HH_MM, { message: 'breakEndTime must be a 24h HH:mm time' })
  breakEndTime: string;

  /** Days of the week this shift runs on (at least one, no duplicates). */
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  @ArrayUnique()
  @ArrayMinSize(1)
  activeDays: DayOfWeek[];
}
