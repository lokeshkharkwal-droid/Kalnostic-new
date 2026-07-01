import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /master-data` — pagination (from `PaginationQueryDto`) plus an
 * optional case-insensitive `name` search and a `branchId` filter (only master
 * data for the given branch). `branchId` is a read filter only; tenant scoping
 * and RLS already protect cross-tenant access.
 */
export class ListMasterDataQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against `name`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Filter: only master data belonging to this branch. */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
