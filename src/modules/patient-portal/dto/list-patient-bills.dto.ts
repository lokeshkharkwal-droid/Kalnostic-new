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

/** Server-side filters + pagination for the patient billing list. */
export class ListPatientBillsDto {
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  /** A branch of the active tenant (validated against the tenant; optional). */
  @IsOptional()
  @IsString()
  branchId?: string;

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

/** Server-side search + pagination for the branch filter dropdown. */
export class ListPatientBranchesDto {
  @IsOptional()
  @IsString()
  search?: string;

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
