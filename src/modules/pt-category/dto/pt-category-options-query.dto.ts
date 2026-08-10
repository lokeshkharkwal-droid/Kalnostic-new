import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /pt-categories/options` — the Create-Order dropdown feed.
 * Pagination (from `PaginationQueryDto`) plus an optional case-insensitive
 * `search` on `categoryName`. Only ACTIVE categories in the active branch are
 * returned.
 */
export class PtCategoryOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
