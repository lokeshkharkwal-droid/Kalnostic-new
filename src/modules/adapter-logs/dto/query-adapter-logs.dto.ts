import { AdapterAction } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Filters for the adapter-log list endpoint, on top of offset pagination.
 * All fields are optional; `tenantId` is never accepted here — it comes from
 * the request context (CLAUDE.md §4.7). `branchId` is honoured only for
 * tenant-level profiles (e.g. `business_admin`); a branch-scoped profile is
 * always locked to its own branch (see `AdapterLogsService.findAllForContext`).
 */
export class QueryAdapterLogsDto extends PaginationQueryDto {
  /**
   * Free-text search (case-insensitive substring) matched against the token,
   * status and source IP address.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Restrict to a single adapter action (ORDERS / SUBMIT_RESULT / OTHER). */
  @IsOptional()
  @IsEnum(AdapterAction)
  action?: AdapterAction;

  /** Restrict to a single textual status (e.g. "SUCCESS"). */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

  /** Restrict to logs at a specific branch (tenant-level profiles only). */
  @IsOptional()
  @IsString()
  branchId?: string;

  /** Inclusive lower bound on `createdAt` (ISO-8601 date or datetime). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive upper bound on `createdAt` (ISO-8601 date or datetime). */
  @IsOptional()
  @IsDateString()
  to?: string;
}
