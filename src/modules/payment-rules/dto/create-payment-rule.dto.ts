import { PaymentCalculationType, PaymentRuleType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Payload for `POST /siteadmin/payment-rules`. Validation is entirely
 * decorator-driven (CLAUDE.md rule #2). `tenantId` / `branchId` /
 * `contextType` / `contextId` are optional Int scope references (not FK
 * relations); `code` uniqueness among active rules is enforced in the service.
 */
export class CreatePaymentRuleDto {
  @IsEnum(PaymentRuleType)
  ruleType: PaymentRuleType;

  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @MaxLength(100)
  code: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsInt()
  @IsOptional()
  tenantId?: number;

  @IsInt()
  @IsOptional()
  branchId?: number;

  /** Priority of the rule (higher-priority rules are ranked first). */
  @IsInt()
  rank: number;

  @IsInt()
  @IsOptional()
  contextType?: number;

  @IsInt()
  @IsOptional()
  contextId?: number;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  class1?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  class2?: string;

  @IsEnum(PaymentCalculationType)
  calculationType: PaymentCalculationType;

  @IsString()
  @MaxLength(255)
  calculationValue: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  taxType?: string;

  @IsInt()
  @IsOptional()
  taxPercentage?: number;

  /** ISO-8601 date string; parsed to a Date in the service. */
  @IsDateString()
  @IsOptional()
  effectivePeriodStartDate?: string;

  /** ISO-8601 date string; parsed to a Date in the service. */
  @IsDateString()
  @IsOptional()
  effectivePeriodEndDate?: string;

  /** Active/inactive status (defaults to `true` in the service). */
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
