import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
import { LabTestListView } from '../entities/lab-test.entity';

/** Sortable columns exposed by the template-browse listing. */
export const LAB_TEST_SORT_FIELDS = [
  'testName',
  'testCode',
  'priceMsrp',
  'createdAt',
] as const;
export type LabTestSortField = (typeof LAB_TEST_SORT_FIELDS)[number];

/**
 * Query parameters for the lab-test listing endpoint
 * (`GET /master-data/:masterDataId/lab-tests/listing`). Extends the shared
 * pagination DTO. `view` selects which columns/nested data are projected;
 * `search` matches `testName`/`testCode` only (per spec); the classification
 * filters take ids (their names are resolved server-side); `status` maps to the
 * `isActive` flag. All filters optional, validated by `class-validator` only.
 */
export class ListLabTestsDto extends PaginationQueryDto {
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

  /** Sort column (template-browse listing). Defaults to `createdAt` desc. */
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
