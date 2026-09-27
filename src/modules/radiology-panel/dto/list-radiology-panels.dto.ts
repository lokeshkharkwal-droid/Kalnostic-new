import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Sortable columns exposed by the radiology-panel listing endpoint.
 * `homeCollectionAvailable` → `isHomeCollection`; `panelCategory` (category name)
 * and `testsCount` are derived sorts handled in the service.
 */
export const RADIOLOGY_PANEL_LISTING_SORT_FIELDS = [
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
export type RadiologyPanelListingSortField =
  (typeof RADIOLOGY_PANEL_LISTING_SORT_FIELDS)[number];

/**
 * Query parameters for the radiology-panel listing endpoint. `search` matches
 * `panelName` OR `panelCode`; `categoryId`/`departmentId` filter by parent
 * classification; `status` maps to `isActive`. Sort runs before pagination.
 */
export class ListRadiologyPanelsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsIn(RADIOLOGY_PANEL_LISTING_SORT_FIELDS)
  sortBy?: RadiologyPanelListingSortField;

  @IsOptional()
  @Type(() => Number)
  @IsIn([1, -1])
  sortOrder?: 1 | -1;
}
