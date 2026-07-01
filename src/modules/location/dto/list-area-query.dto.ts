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
 * Query for listing areas — pagination plus an optional case-insensitive
 * `search` (`name`/`locality`), cascading `cityId`/`stateId`/`countryId`
 * filters, and an `isActive` filter.
 */
export class ListAreaQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against `name` or `locality`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Cascading filter: only areas belonging to this city. */
  @IsOptional()
  @IsUUID()
  cityId?: string;

  /** Cascading filter: only areas belonging to this state. */
  @IsOptional()
  @IsUUID()
  stateId?: string;

  /** Cascading filter: only areas belonging to this country. */
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
