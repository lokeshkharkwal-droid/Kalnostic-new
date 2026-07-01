import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { SubCategoryType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /sub-categories` — pagination (from `PaginationQueryDto`) plus
 * an optional case-insensitive search (matched against `name` and `code`), a
 * `subCategoryType` filter, an active/inactive `status` filter, and cascading
 * `departmentId` / `categoryId` filters. Backs the lab-test form's
 * infinite-scroll Sub-Category dropdown.
 */
export class ListSubCategoryQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against `name` or `code`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /**
   * Filter by sub-category type (`INDEPENDENT`, `UNDER_DEPARTMENT`, or
   * `UNDER_CATEGORY`).
   */
  @IsOptional()
  @IsEnum(SubCategoryType)
  subCategoryType?: SubCategoryType;

  /** Filter by active (`ACTIVE`) or inactive (`INACTIVE`) sub-categories. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  /** Cascading filter: only sub-categories linked to this department. */
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Cascading filter: only sub-categories linked to this category. */
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
