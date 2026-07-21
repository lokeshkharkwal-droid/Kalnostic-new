import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for listing cities — pagination plus an optional case-insensitive
 * `search` (`name`/`pinCode`), cascading `stateId`/`countryId` filters, and an
 * `isActive` filter.
 */
export class ListCityQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against `name` or `pinCode`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Cascading filter: only cities belonging to this state. */
  @IsOptional()
  @IsUUID()
  stateId?: string;

  /** Cascading filter: only cities belonging to this country. */
  @IsOptional()
  @IsUUID()
  countryId?: string;

  /** Status filter (query params arrive as strings; coerce to a boolean). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}
