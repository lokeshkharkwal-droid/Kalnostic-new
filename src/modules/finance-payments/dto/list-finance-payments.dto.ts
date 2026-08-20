import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { FinancePaymentsSummaryQueryDto } from './finance-payments-summary-query.dto';

/**
 * Query DTO for the Finance → Payments **records** endpoint: the shared filters
 * plus offset pagination. Unlike the summary, this list honours `mode` and
 * `status`.
 */
export class ListFinancePaymentsDto extends FinancePaymentsSummaryQueryDto {
  /** 1-based page number (defaults to 1 in the service). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** page size (defaults to 20, capped at 100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
