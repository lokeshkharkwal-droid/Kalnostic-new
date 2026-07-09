import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /siteadmin/contact-us` — pagination (from `PaginationQueryDto`)
 * plus an optional case-insensitive `search` (matched against `name`,
 * `mobileNumber`, or `email`) and an inclusive `createdAt` date range
 * (`from` / `to`). Mirrors the audit-log query pattern.
 */
export class ListContactSubmissionQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against `name`, `mobileNumber`, or `email`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Inclusive lower bound on `createdAt` (ISO-8601 date or datetime). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive upper bound on `createdAt` (ISO-8601 date or datetime). */
  @IsOptional()
  @IsDateString()
  to?: string;
}
