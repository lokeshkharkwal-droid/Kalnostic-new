import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
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

  /**
   * Server-side sort column. This list merges two sources (direct payments +
   * invoice receipts) with a stable `createdAt`/`id` prefix-merge, so only
   * `dateTime` (the shared payment timestamp = `createdAt`) can be sorted
   * consistently across both; other columns are source-specific / derived and
   * render without a sort affordance. Defaults to `dateTime`.
   */
  @IsOptional()
  @IsIn(['dateTime'])
  sortBy?: 'dateTime';

  /** Sort direction for {@link sortBy} (`asc` | `desc`, default `desc`). */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
