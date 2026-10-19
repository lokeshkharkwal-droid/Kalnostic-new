import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';

/**
 * Sortable columns exposed by the radiology-panel listing endpoint. Scalar keys
 * map straight to a Prisma `orderBy`; `panelCategory` (category name) and
 * `testsCount` (included-test count) are derived sorts handled in the service
 * (sort the full set, then paginate).
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
  'testsCount',
  'isActive',
] as const;
export type RadiologyPanelListingSortField =
  (typeof RADIOLOGY_PANEL_LISTING_SORT_FIELDS)[number];

/** Sortable columns exposed by the template-browse listing. */
export const RADIOLOGY_PANEL_SORT_FIELDS = [
  'panelName',
  'panelCode',
  'priceMsrp',
  'createdAt',
] as const;
export type RadiologyPanelSortField =
  (typeof RADIOLOGY_PANEL_SORT_FIELDS)[number];

/**
 * Query parameters for the radiology-panel listing endpoint
 * (`GET /master-data/:masterDataId/radiology-panels/listing`). Extends the shared
 * pagination DTO. `search` matches `panelName` OR `panelCode` (case-insensitive);
 * `categoryId`/`departmentId` filter by parent category/department; `status`
 * maps to the `isActive` flag. Server-side sort runs **before** pagination:
 * `sortBy` is validated against {@link RADIOLOGY_PANEL_LISTING_SORT_FIELDS};
 * `sortOrder` is `1` (ascending) or `-1` (descending). All optional, validated
 * by `class-validator` only.
 */
export class ListRadiologyPanelsDto extends PaginationQueryDto {
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
  @IsIn(RADIOLOGY_PANEL_LISTING_SORT_FIELDS)
  sortBy?: RadiologyPanelListingSortField;

  /** Sort direction: `1` ascending, `-1` descending. */
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, -1])
  sortOrder?: 1 | -1;
}

/**
 * Query parameters for the template-browse listing (SiteAdmin
 * `GET /siteadmin/radiology-panels` and business
 * `GET .../radiology-panels/templates`). Keeps its own narrow `sortBy` +
 * `asc`/`desc` `sortOrder` contract. When a business caller supplies a
 * `masterDataId`, each row is annotated with `isImported`.
 */
export class BrowseRadiologyPanelTemplatesDto extends PaginationQueryDto {
  /** Free-text match against `panelName` OR `panelCode` (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Active/inactive filter; mapped to `isActive` in the service. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsIn(RADIOLOGY_PANEL_SORT_FIELDS)
  sortBy?: RadiologyPanelSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  /**
   * Template-browse only: the target master data to compare against. When set,
   * each template row is annotated with `isImported` (an active tenant panel in
   * this master data already has `clonedFromId = template.id`).
   */
  @IsOptional()
  @IsUUID()
  masterDataId?: string;

  /**
   * Template-browse only: when true (and `masterDataId` is set), templates
   * already imported into that master data are excluded from the results.
   */
  @IsOptional()
  @ToBoolean()
  notImportedOnly?: boolean;
}
