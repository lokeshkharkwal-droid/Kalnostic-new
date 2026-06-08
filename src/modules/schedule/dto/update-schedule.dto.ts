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
 * Partial update of a schedule (all fields optional; rules mirror
 * CreateScheduleDto). `branchId`/`tenantId` are never updatable.
 */
export class UpdateScheduleDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  planName?: string;

  @IsEnum(ScheduleStatus)
  @IsOptional()
  status?: ScheduleStatus;

  @IsDateString()
  @IsOptional()
  effectiveFrom?: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftDto)
  @ArrayMinSize(1)
  @IsOptional()
  shifts?: ShiftDto[];
}
