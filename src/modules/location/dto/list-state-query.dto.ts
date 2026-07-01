import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for listing states — pagination plus an optional case-insensitive
 * `search` (`name`/`code`), a cascading `countryId` filter, and an `isActive`
 * filter.
 */
export class ListStateQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against `name` or `code`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Cascading filter: only states belonging to this country. */
  @IsOptional()
  @IsUUID()
  countryId?: string;

  /** Status filter (query params arrive as strings; coerce to a boolean). */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  isActive?: boolean;
}
