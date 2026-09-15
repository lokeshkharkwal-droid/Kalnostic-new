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
import { LabTestListView } from '../entities/lab-test.entity';

/**
 * Sortable columns exposed by the **listing** endpoint
 * (`GET /master-data/:masterDataId/lab-tests/listing`). Every key the grid can
 * sort by across its views. Scalar keys map straight to a Prisma `orderBy`;
 * `departmentName` sorts via the `department` relation; `parametersCount` /
 * `samplesCount` are derived (aggregated) sorts handled in the service. The
 * grid's "Default Sample" column is intentionally **not** sortable (its value is
 * a filtered child row Prisma `orderBy` can't express).
 */
export const LAB_TEST_LISTING_SORT_FIELDS = [
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
export type LabTestListingSortField =
  (typeof LAB_TEST_LISTING_SORT_FIELDS)[number];

/** Sortable columns exposed by the template-browse listing (unchanged). */
export const LAB_TEST_SORT_FIELDS = [
  'testName',
  'testCode',
  'priceMsrp',
  'createdAt',
] as const;
export type LabTestSortField = (typeof LAB_TEST_SORT_FIELDS)[number];

/**
 * Shared filter fields for the lab-test list/listing/template-browse endpoints:
 * `view` selects which columns/nested data are projected; `search` matches
 * `testName`/`testCode` only; the classification filters take ids (their names
 * are resolved server-side); `status` maps to the `isActive` flag. All optional,
 * validated by `class-validator` only. Sort fields live on the concrete
 * subclasses so each endpoint keeps its own sort contract.
 */
class LabTestListFilterDto extends PaginationQueryDto {
  /** Column view; defaults to DEFAULT in the service when omitted. */
  @IsOptional()
  @IsEnum(LabTestListView)
  view?: LabTestListView;

  /** Free-text match against `testName` OR `testCode` (case-insensitive). */
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

  /**
   * Filter to tests that have at least one (non-deleted) sample of this type.
   * Matches against the `sampleType` free-text on the test's child samples.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sampleType?: string;

  /** Active/inactive filter; mapped to `isActive` in the service. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

/**
 * Query parameters for the tenant lab-test list/listing endpoints
 * (`GET /master-data/:masterDataId/lab-tests` and `/listing`). Server-side sort
 * is applied **before** pagination: `sortBy` is validated against
 * {@link LAB_TEST_LISTING_SORT_FIELDS}; `sortOrder` is `1` (ascending) or `-1`
 * (descending). Omit both to keep the default (`createdAt desc`).
 */
export class ListLabTestsDto extends LabTestListFilterDto {
  /** Sort column; validated against the listing allowlist. */
  @IsOptional()
  @IsIn(LAB_TEST_LISTING_SORT_FIELDS)
  sortBy?: LabTestListingSortField;

  /** Sort direction: `1` ascending, `-1` descending. */
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, -1])
  sortOrder?: 1 | -1;
}

/**
 * Query parameters for the template-browse listing
 * (SiteAdmin `GET /siteadmin/lab-tests` and business `GET .../lab-tests/templates`).
 * Keeps its own `sortBy` (narrow allowlist) + `sortOrder` (`asc`/`desc`) contract
 * that the frontend template importer depends on.
 */
export class BrowseLabTestTemplatesDto extends LabTestListFilterDto {
  /** Sort column (template-browse). Defaults to `createdAt` in the service. */
  @IsOptional()
  @IsIn(LAB_TEST_SORT_FIELDS)
  sortBy?: LabTestSortField;

  /** Sort direction; defaults to `desc`. */
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
