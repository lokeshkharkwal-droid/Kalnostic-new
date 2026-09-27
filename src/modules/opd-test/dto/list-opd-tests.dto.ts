import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
import { OpdTestListView } from '../entities/opd-test.entity';

/** Sortable columns exposed by the opd-test **listing** endpoint. */
export const OPD_TEST_LISTING_SORT_FIELDS = [
  'testName',
  'testCode',
  'aka',
  'processMethod',
  'icdCode',
  'loincCode',
  'samplePriorityType',
  'isMandatoryTest',
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
  'departmentName',
  'parametersCount',
  'samplesCount',
] as const;
export type OpdTestListingSortField =
  (typeof OPD_TEST_LISTING_SORT_FIELDS)[number];

/** Sortable columns exposed by the template-browse listing. */
export const OPD_TEST_SORT_FIELDS = [
  'testName',
  'testCode',
  'priceMsrp',
  'createdAt',
] as const;
export type OpdTestSortField = (typeof OPD_TEST_SORT_FIELDS)[number];

/**
 * Shared filter fields for the opd-test list/listing/template-browse
 * endpoints: `view` selects which columns/nested data are projected; `search`
 * matches `testName`/`testCode`; the classification filters take ids; `status`
 * maps to `isActive`.
 */
class OpdTestListFilterDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(OpdTestListView)
  view?: OpdTestListView;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  subCategoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sampleType?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

/**
 * Query parameters for the tenant opd-test list/listing endpoints. Sort is
 * applied before pagination: `sortBy` validated against the listing allowlist;
 * `sortOrder` is `1` (asc) or `-1` (desc). Omit both for `createdAt desc`.
 */
export class ListOpdTestsDto extends OpdTestListFilterDto {
  @IsOptional()
  @IsIn(OPD_TEST_LISTING_SORT_FIELDS)
  sortBy?: OpdTestListingSortField;

  @IsOptional()
  @Type(() => Number)
  @IsIn([1, -1])
  sortOrder?: 1 | -1;
}

/**
 * Query parameters for the template-browse listing (SiteAdmin
 * `GET /siteadmin/opd-tests` and business `.../opd-tests/templates`).
 */
export class BrowseOpdTestTemplatesDto extends OpdTestListFilterDto {
  @IsOptional()
  @IsIn(OPD_TEST_SORT_FIELDS)
  sortBy?: OpdTestSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsUUID()
  masterDataId?: string;

  @IsOptional()
  @ToBoolean()
  notImportedOnly?: boolean;
}
