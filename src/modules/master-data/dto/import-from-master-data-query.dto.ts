import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for the "import from master data" endpoints
 * (`GET /master-data/import/lab-tests` and `.../lab-panels`). The caller (the
 * frontend) supplies the **active branch id** — extracted from the JWT on the
 * client — and the backend resolves the single master data mapped to that
 * branch. `branchId` is still validated against the caller's tenant server-side
 * (CLAUDE.md §4.7). Extends `PaginationQueryDto` (`page`/`limit`) and adds an
 * optional case-insensitive `search`.
 */
export class ImportFromMasterDataQueryDto extends PaginationQueryDto {
  /** Active branch whose mapped master data to import from. */
  @IsUUID()
  branchId!: string;

  /** Case-insensitive match against name/code. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Case-insensitive match against the department name (tests and panels). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  department?: string;

  /** Case-insensitive match against the category name (tests and panels). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  /** Case-insensitive match against the sub-category name (lab tests only — panels have no sub-category). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subCategory?: string;

  /**
   * When given, tests already present in this pricing list (matched via
   * `BranchLabTest.sourceLabTestId`/`BranchLabPanel.sourceLabPanelId`) are
   * excluded from the result — lets an "Add Tests to List" picker's
   * "Available to Add" side exclude already-imported rows server-side.
   */
  @IsOptional()
  @IsUUID()
  excludeListId?: string;
}
