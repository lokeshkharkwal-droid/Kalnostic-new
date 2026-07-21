import {
  ConsultationMode,
  DayOfWeek,
  DoctorScheduleStatus,
  RecurrencePattern,
  ScheduleSlotType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ScheduleHolidayDto } from './schedule-holiday.dto';
import { ScheduleOverrideDto } from './schedule-override.dto';

/** 24-hour `HH:mm` clock time, e.g. `09:00`, `17:30`. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Partial update of a doctor schedule (all fields optional; rules mirror
 * CreateDoctorScheduleDto). `doctorId`/`branchId`/`tenantId` are never updatable
 * — a schedule stays with its doctor + branch. When a field affecting slot
 * generation changes, future unbooked slots are regenerated in the service.
 */
export class UpdateDoctorScheduleDto {
  @IsOptional()
  @IsArray()
  @IsEnum(ConsultationMode, { each: true })
  @ArrayUnique()
  @ArrayMinSize(1)
  consultationMode?: ConsultationMode[];

  @IsOptional()
  @IsEnum(ScheduleSlotType)
  slotType?: ScheduleSlotType;

  @IsOptional()
  @IsEnum(DoctorScheduleStatus)
  status?: DoctorScheduleStatus;

  @IsOptional()
  @Matches(HH_MM, { message: 'startTime must be a 24h HH:mm time' })
  startTime?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'endTime must be a 24h HH:mm time' })
  endTime?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'breakStart must be a 24h HH:mm time' })
  breakStart?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'breakEnd must be a 24h HH:mm time' })
  breakEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  slotIntervalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPatientsPerSlot?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bufferMinutes?: number;

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
