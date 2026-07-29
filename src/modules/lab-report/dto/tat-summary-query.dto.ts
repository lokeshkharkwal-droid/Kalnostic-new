import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

/**
 * Filters for the TAT analytics summary (`GET /lab-reports/tat/summary`,
 * SRS §9). All optional: an `approvedAt` date range and an explicit branch
 * override (defaults to the caller's active branch).
 */
export class TatSummaryQueryDto {
  /** Inclusive lower bound on `approvedAt` (ISO 8601). */
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  /** Inclusive upper bound on `approvedAt` (ISO 8601). */
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  /** Report on this branch instead of the caller's active branch. */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
