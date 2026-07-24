import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Optional filters shared by both sales reports (lead-wise + salesperson-wise).
 * All fields are optional; the reports return every scoped row when unset. Dates
 * are ISO strings (yyyy-mm-dd) applied to `leadAt`.
 */
export class SalesReportQueryDto {
  /** ISO date (yyyy-mm-dd) lower bound on lead date. */
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** ISO date (yyyy-mm-dd) upper bound on lead date. */
  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  salespersonId?: string;

  @IsOptional()
  @IsUUID()
  territoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  /** Free-text search over lead code / organization / primary contact name. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
