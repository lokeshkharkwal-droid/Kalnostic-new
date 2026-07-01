import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for listing countries — pagination (from `PaginationQueryDto`) plus an
 * optional case-insensitive `search` (matched against `name`/`code`) and an
 * `isActive` filter.
 */
export class ListCountryQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against `name` or `code`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Status filter (query params arrive as strings; coerce to a boolean). */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  isActive?: boolean;
}
