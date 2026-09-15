import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Sortable columns exposed by the lab-panel listing endpoint. Scalar keys map
 * straight to a Prisma `orderBy` (`homeCollectionAvailable` → `isHomeCollection`);
 * `panelCategory` (category name) and `testsCount` (included-test count) are
 * derived sorts handled in the service (sort the full set, then paginate).
 */
export const LAB_PANEL_LISTING_SORT_FIELDS = [
  'panelName',
  'panelCode',
  'panelCategory',
  'priceOriginal',
  'priceMinimum',
  'priceMaximum',
  'priceMsrp',
  'franchisePrice',
  'applicableAgeGroup',
  'homeCollectionAvailable',
  'testsCount',
  'isActive',
] as const;
export type LabPanelListingSortField =
  (typeof LAB_PANEL_LISTING_SORT_FIELDS)[number];

/**
 * Query parameters for the lab-panel listing endpoint
 * (`GET /master-data/:masterDataId/lab-panels/listing`). Extends the shared
 * pagination DTO. `search` matches `panelName` OR `panelCode` (case-insensitive);
 * `categoryId`/`departmentId` filter by parent category/department; `status`
 * maps to the `isActive` flag. Server-side sort runs **before** pagination:
 * `sortBy` is validated against {@link LAB_PANEL_LISTING_SORT_FIELDS};
 * `sortOrder` is `1` (ascending) or `-1` (descending). All optional, validated
 * by `class-validator` only.
 */
export class ListLabPanelsDto extends PaginationQueryDto {
  /** Free-text match against `panelName` OR `panelCode` (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Parent category filter. */
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Parent department filter. */
  @IsOptional()
  @IsString()
  departmentId?: string;

  /** Active/inactive filter; mapped to `isActive` in the service. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  /** Sort column; validated against the listing allowlist. */
  @IsOptional()
  @IsIn(LAB_PANEL_LISTING_SORT_FIELDS)
  sortBy?: LabPanelListingSortField;

  /** Sort direction: `1` ascending, `-1` descending. */
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, -1])
  sortOrder?: 1 | -1;
}
