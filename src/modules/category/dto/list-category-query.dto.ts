import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CategoryType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /categories` — pagination (from `PaginationQueryDto`) plus an
 * optional case-insensitive search (matched against `name` and `code`), a
 * `categoryType` filter, an active/inactive `status` filter, and a cascading
 * `departmentId` filter (only categories under the given department). Backs the
 * lab-test form's infinite-scroll Category dropdown.
 */
export class ListCategoryQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against `name` or `code`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Filter by category type (`INDEPENDENT` or `UNDER_DEPARTMENT`). */
  @IsOptional()
  @IsEnum(CategoryType)
  categoryType?: CategoryType;

  /** Filter by active (`ACTIVE`) or inactive (`INACTIVE`) categories. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  /** Cascading filter: only categories linked to this department. */
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
