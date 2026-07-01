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
 * Payload for `PATCH /siteadmin/payment-rules/:id`. All fields optional; mirrors
 * CreatePaymentRuleDto (explicit optionals, not `PartialType`, matching the
 * existing update DTOs). Changing `code` is re-validated for uniqueness in the
 * service.
 */
export class UpdatePaymentRuleDto {
  @IsEnum(PaymentRuleType)
  @IsOptional()
  ruleType?: PaymentRuleType;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  code?: string;

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

  @IsInt()
  @IsOptional()
  rank?: number;

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
  @IsOptional()
  calculationType?: PaymentCalculationType;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  calculationValue?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  taxType?: string;

  @IsInt()
  @IsOptional()
  taxPercentage?: number;

  @IsDateString()
  @IsOptional()
  effectivePeriodStartDate?: string;

  @IsDateString()
  @IsOptional()
  effectivePeriodEndDate?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
