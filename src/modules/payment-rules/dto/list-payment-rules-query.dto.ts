import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaymentRuleType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /siteadmin/payment-rules` — pagination (from
 * `PaginationQueryDto`) plus optional case-insensitive search by `name` and
 * `code`, and exact-match filters by `tenantId`, `ruleType`, and `status`.
 */
export class ListPaymentRulesQueryDto extends PaginationQueryDto {
  /** Case-insensitive substring match against `name`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  /** Case-insensitive substring match against `code`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  /** Filter to rules scoped to this tenant id. */
  @IsOptional()
  @Type(() => Number) // query params arrive as strings; coerce to number
  @IsInt()
  tenantId?: number;

  /** Filter by rule type. */
  @IsOptional()
  @IsEnum(PaymentRuleType)
  ruleType?: PaymentRuleType;

  /** Filter by active (`ACTIVE`) or inactive (`INACTIVE`) status. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
