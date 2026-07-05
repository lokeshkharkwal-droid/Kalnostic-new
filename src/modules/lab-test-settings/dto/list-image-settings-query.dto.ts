import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query params for listing image settings: offset pagination plus optional
 * server-side search.
 *
 * - `search` does a case-insensitive match against the setting `name`.
 */
export class ListImageSettingsQueryDto extends PaginationQueryDto {
  /** Case-insensitive search against the setting name. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
