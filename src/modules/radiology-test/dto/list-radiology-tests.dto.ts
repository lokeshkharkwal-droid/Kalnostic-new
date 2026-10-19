import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RadiologyModality } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
import { RadiologyTestListView } from '../entities/radiology-test.entity';

/**
 * Sortable columns exposed by the **listing** endpoint
 * (`GET /master-data/:masterDataId/radiology-tests/listing`). Scalar keys map
 * straight to a Prisma `orderBy`; `departmentName` sorts via the (logical)
 * department ref resolved in-memory, so it is intentionally NOT in this
 * allowlist (the flat model has no `department` Prisma relation to order on).
 */
export const RADIOLOGY_TEST_LISTING_SORT_FIELDS = [
  'testName',
  'testCode',
  'aka',
  'modality',
  'bodyPart',
  'icdCode',
  'loincCode',
  'samplePriorityType',
  'priceMsrp',
  'priceMinimum',
  'priceMaximum',
  'priceOriginal',
  'franchisePrice',
  'emergencyPrice',
  'discountCapPct',
  'tatMinValue',
  'tatMaxValue',
  'isAllowPriceOverride',
  'isAllowDiscounts',
  'isHideInOrderScreen',
  'isEnableCms',
  'isPreferenceTest',
  'usefulFor',
  'isActive',
] as const;
export type RadiologyTestListingSortField =
  (typeof RADIOLOGY_TEST_LISTING_SORT_FIELDS)[number];

/** Sortable columns exposed by the template-browse listing. */
export const RADIOLOGY_TEST_SORT_FIELDS = [
  'testName',
  'testCode',
  'priceMsrp',
  'createdAt',
] as const;
export type RadiologyTestSortField =
  (typeof RADIOLOGY_TEST_SORT_FIELDS)[number];

/**
 * Shared filter fields for the radiology-test list/listing/template-browse
 * endpoints: `view` selects which columns are projected; `search` matches
 * `testName`/`testCode` only; `modality` filters by imaging modality; the
 * classification filters take ids; `status` maps to the `isActive` flag. All
 * optional, validated by `class-validator` only.
 */
class RadiologyTestListFilterDto extends PaginationQueryDto {
  /** Column view; defaults to DEFAULT in the service when omitted. */
  @IsOptional()
  @IsEnum(RadiologyTestListView)
  view?: RadiologyTestListView;

  /** Free-text match against `testName` OR `testCode` (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Filter by imaging modality. */
  @IsOptional()
  @IsEnum(RadiologyModality)
  modality?: RadiologyModality;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  subCategoryId?: string;

  /** Active/inactive filter; mapped to `isActive` in the service. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

/**
 * Query parameters for the tenant radiology-test list/listing endpoints
 * (`GET /master-data/:masterDataId/radiology-tests` and `/listing`). `sortBy` is
 * validated against {@link RADIOLOGY_TEST_LISTING_SORT_FIELDS}; `sortOrder` is
 * `1` (ascending) or `-1` (descending). Omit both for the default
 * (`createdAt desc`).
 */
export class ListRadiologyTestsDto extends RadiologyTestListFilterDto {
  @IsOptional()
  @IsIn(RADIOLOGY_TEST_LISTING_SORT_FIELDS)
  sortBy?: RadiologyTestListingSortField;

  @IsOptional()
  @Type(() => Number)
  @IsIn([1, -1])
  sortOrder?: 1 | -1;
}

/**
 * Query parameters for the template-browse listing (SiteAdmin
 * `GET /siteadmin/radiology-tests` and business
 * `GET .../radiology-tests/templates`). Keeps its own narrow `sortBy` +
 * `asc`/`desc` `sortOrder` contract.
 */
export class BrowseRadiologyTestTemplatesDto extends RadiologyTestListFilterDto {
  @IsOptional()
  @IsIn(RADIOLOGY_TEST_SORT_FIELDS)
  sortBy?: RadiologyTestSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  /**
   * Template-browse only: the target master data to compare against. When set,
   * each template row is annotated with `isImported` (an active tenant test in
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
