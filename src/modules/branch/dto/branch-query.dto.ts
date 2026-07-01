import { BranchStatus, BranchType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for listing branches: offset pagination (`page`/`limit` from
 * {@link PaginationQueryDto}) plus optional server-side search and filters.
 *
 * - `search` does a case-insensitive match against branch `name` OR `code`.
 * - `status` / `branchType` are exact-match filters on the respective enum.
 *
 * All filters are optional; omitting them lists every (non-deleted) branch in
 * the tenant. Invalid enum values are rejected by the global validation pipe.
 */
export class BranchQueryDto extends PaginationQueryDto {
  /** Case-insensitive search across branch name and code. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Filter by branch status (e.g. `ACTIVE`). */
  @IsOptional()
  @IsEnum(BranchStatus)
  status?: BranchStatus;

  /** Filter by branch type (e.g. `COLLECTION_CENTER`). */
  @IsOptional()
  @IsEnum(BranchType)
  branchType?: BranchType;
}
