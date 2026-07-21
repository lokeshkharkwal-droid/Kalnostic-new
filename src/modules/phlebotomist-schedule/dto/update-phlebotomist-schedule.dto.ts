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
 * Partial update of a phlebotomist schedule (all fields optional; rules mirror
 * CreatePhlebotomistScheduleDto). `phlebotomistId`/`branchId`/`tenantId` are never
 * updatable — a schedule stays with its phlebotomist + branch. When a field
 * affecting slot generation changes, future unbooked slots are regenerated in the
 * service.
 */
export class UpdatePhlebotomistScheduleDto {
  @IsOptional()
  @IsEnum(PhleboServiceType)
  serviceType?: PhleboServiceType;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayUnique()
  zoneIds?: string[];

  @IsOptional()
  @IsEnum(PhlebotomistScheduleStatus)
  status?: PhlebotomistScheduleStatus;

  @IsOptional()
  @Matches(HH_MM, { message: 'startTime must be a 24h HH:mm time' })
  startTime?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'endTime must be a 24h HH:mm time' })
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  travelBufferMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxVisitsPerDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  slotCapacity?: number;

  @IsOptional()
  @IsEnum(RecurrencePattern)
  recurrencePattern?: RecurrencePattern;

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

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  horizonWeeks?: number;
}
