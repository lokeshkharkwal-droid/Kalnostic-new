import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /patient-categories` — pagination (from `PaginationQueryDto`)
 * plus an optional case-insensitive `search` (matched against `name`) and an
 * active/inactive `status` filter.
 */
export class ListPatientCategoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
