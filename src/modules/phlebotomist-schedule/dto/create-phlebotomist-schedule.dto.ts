import {
  DayOfWeek,
  PhleboServiceType,
  PhlebotomistScheduleStatus,
  RecurrencePattern,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ScheduleHolidayDto } from './schedule-holiday.dto';
import { ScheduleOverrideDto } from './schedule-override.dto';

/** 24-hour `HH:mm` clock time, e.g. `08:00`, `17:00`. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Create a phlebotomist schedule (the "Configure Phlebotomist Schedule" form).
 * `tenantId` **and** `branchId` come from the JWT and never the body
 * (CLAUDE.md §4.7); `phlebotomistId` is validated against the caller's
 * tenant/branch in the service. Cross-field rules (end after start, interval > 0,
 * etc.) are enforced in `PhlebotomistScheduleService`.
 */
export class CreatePhlebotomistScheduleDto {
  @IsUUID()
  phlebotomistId: string;

  @IsEnum(PhleboServiceType)
  serviceType: PhleboServiceType;

  /** Service areas/zones the phlebotomist serves (multiple, no duplicates). */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayUnique()
  zoneIds?: string[];

  /** Defaults to ACTIVE when omitted. */
  @IsOptional()
  @IsEnum(PhlebotomistScheduleStatus)
  status?: PhlebotomistScheduleStatus;

  @Matches(HH_MM, { message: 'startTime must be a 24h HH:mm time' })
  startTime: string;

  @Matches(HH_MM, { message: 'endTime must be a 24h HH:mm time' })
  endTime: string;

  /** Length of each visit slot, in minutes. */
  @IsInt()
  @Min(1)
  intervalMinutes: number;

  /** Extra travel time added after each visit before the next slot starts. */
  @IsOptional()
  @IsInt()
  @Min(0)
  travelBufferMinutes?: number;

  @IsInt()
  @Min(1)
  maxVisitsPerDay: number;

  @IsInt()
  @Min(1)
  slotCapacity: number;

  @IsEnum(RecurrencePattern)
  recurrencePattern: RecurrencePattern;

  /**
   * Days the schedule runs on. Required (non-empty) for WEEKLY/CUSTOM; ignored
   * for DAILY. No duplicates.
   */
  @IsOptional()
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  @ArrayUnique()
  selectedDays?: DayOfWeek[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleHolidayDto)
  holidays?: ScheduleHolidayDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleOverrideDto)
  overrides?: ScheduleOverrideDto[];

  /**
   * How many weeks ahead to generate slots from today (1–52). Defaults to 8 in
   * the service.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  horizonWeeks?: number;
}
