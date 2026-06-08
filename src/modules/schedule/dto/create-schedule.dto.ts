import { ScheduleStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ShiftDto } from './shift.dto';

/**
 * Create a schedule for a branch. The owning `branchId` comes from the route,
 * and `tenantId` from the JWT — neither is accepted in the body (CLAUDE.md §4.7).
 */
export class CreateScheduleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  planName: string;

  /** Defaults to DRAFT when omitted. Only ACTIVE schedules are overlap-checked. */
  @IsEnum(ScheduleStatus)
  @IsOptional()
  status?: ScheduleStatus;

  @IsDateString()
  effectiveFrom: string;

  /** Null/omitted = open-ended (no end date). */
  @IsDateString()
  @IsOptional()
  effectiveTo?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftDto)
  @ArrayMinSize(1)
  shifts: ShiftDto[];
}
