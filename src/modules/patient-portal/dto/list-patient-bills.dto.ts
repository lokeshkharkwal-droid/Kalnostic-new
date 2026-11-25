import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { BillStatus } from '@prisma/client';

/**
 * Server-side filters + pagination for the patient billing list. The listing is
 * person-scoped and consolidated across EVERY business (tenant) the patient is
 * enrolled in; `tenantId` narrows it to a single business (the "Business" filter).
 */
export class ListPatientBillsDto {
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  /** A single business (tenant) the patient belongs to; optional — omit for all. */
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsEnum(BillStatus)
  billStatus?: BillStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
