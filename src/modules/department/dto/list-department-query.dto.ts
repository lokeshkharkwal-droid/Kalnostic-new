import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BranchType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /departments` — pagination (from `PaginationQueryDto`) plus an
 * optional case-insensitive search (matched against `name` and `code`), an
 * active/inactive `status` filter, and a `moduleMapping` filter. Used to back
 * the lab-test form's infinite-scroll Department dropdown.
 */
export class ListDepartmentQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against `name` or `code`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Filter by active (`ACTIVE`) or inactive (`INACTIVE`) departments. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  /** Filter to departments whose `moduleMapping` includes this branch type. */
  @IsOptional()
  @IsEnum(BranchType)
  moduleMapping?: BranchType;
}
