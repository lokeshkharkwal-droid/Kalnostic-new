import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Shared query DTO for **offset-based** pagination (CLAUDE.md §6 / SKILL.md §6).
 *
 * Offset pagination maps cleanly onto the `meta` response envelope
 * (`total` / `page` / `limit` / `totalPages`). Use it on list endpoints:
 * `findMany(@Query() query: PaginationQueryDto)`.
 */
export class PaginationQueryDto {
  /** 1-based page number (defaults to 1 in services). */
  @IsOptional()
  @Type(() => Number) // query params arrive as strings; coerce to number
  @IsInt()
  @Min(1)
  page?: number;

  /** page size (defaults to 20 in services, hard-capped at 100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
