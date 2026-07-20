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
  IsUUID,
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
 * Create a doctor schedule (the "Configure Doctor Schedule" form). `tenantId`
 * comes from the JWT and never the body (CLAUDE.md §4.7); `branchId` is
 * client-supplied and validated against the caller's tenant in the service.
 * Cross-field rules (break inside window, interval ≥ duration, etc.) are enforced
 * in `DoctorScheduleService`.
 */
export class CreateDoctorScheduleDto {
  @IsUUID()
  doctorId: string;

  @IsUUID()
  branchId: string;

  /** Consultation modes offered by this schedule (at least one, no duplicates). */
  @IsArray()
  @IsEnum(ConsultationMode, { each: true })
  @ArrayUnique()
  @ArrayMinSize(1)
  consultationMode: ConsultationMode[];

  @IsEnum(ScheduleSlotType)
  slotType: ScheduleSlotType;

  /** Defaults to ACTIVE when omitted. */
  @IsOptional()
  @IsEnum(DoctorScheduleStatus)
  status?: DoctorScheduleStatus;

  @Matches(HH_MM, { message: 'startTime must be a 24h HH:mm time' })
  startTime: string;

  @Matches(HH_MM, { message: 'endTime must be a 24h HH:mm time' })
  endTime: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'breakStart must be a 24h HH:mm time' })
  breakStart?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'breakEnd must be a 24h HH:mm time' })
  breakEnd?: string;

  @IsInt()
  @Min(1)
  durationMinutes: number;

  @IsInt()
  @Min(1)
  slotIntervalMinutes: number;

  @IsInt()
  @Min(1)
  maxPatientsPerSlot: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bufferMinutes?: number;

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
