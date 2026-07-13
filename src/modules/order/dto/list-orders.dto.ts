import { BillingType, OrderStatus, OrderType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the order listing endpoint. Extends the shared pagination
 * DTO. `search` matches `orderCode` (case-insensitive). `dateFrom`/`dateTo`
 * filter `orderDate` inclusively. All filters optional.
 */
export class ListOrdersDto extends PaginationQueryDto {
  /** Free-text match against `orderCode` (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  @IsOptional()
  @IsEnum(BillingType)
  billingType?: BillingType;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** `isBillGenerated` filter (query strings `'true'`/`'false'` are coerced). */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isBillGenerated?: boolean;

  /** Inclusive lower bound on `orderDate` (ISO-8601 date). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Inclusive upper bound on `orderDate` (ISO-8601 date). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
