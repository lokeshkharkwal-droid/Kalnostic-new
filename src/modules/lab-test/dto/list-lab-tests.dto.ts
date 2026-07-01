import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { LabTestListView } from '../entities/lab-test.entity';

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
}
