import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /pt-categories` — pagination (from `PaginationQueryDto`) plus
 * an optional case-insensitive `search` (matched against `categoryName`) and an
 * active/inactive `status` filter.
 */
export class ListPtCategoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
