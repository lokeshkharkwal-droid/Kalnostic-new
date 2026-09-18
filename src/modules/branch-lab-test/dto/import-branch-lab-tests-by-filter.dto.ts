import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * "Select all" import payload: the same search/classification filters as the
 * import-picker's "Available to Add" listing (`GET /master-data/import/lab-tests`)
 * — no client-supplied id list. The backend re-resolves every Master Data lab
 * test matching these filters (excluding ones already in the target list) and
 * imports all of them, so a filtered "select all" never round-trips a
 * potentially huge id array through the client.
 */
export class ImportBranchLabTestsByFilterDto {
  /** Case-insensitive match against name/code. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Case-insensitive match against the department name. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  department?: string;

  /** Case-insensitive match against the category name. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  /** Case-insensitive match against the sub-category name. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subCategory?: string;

  /**
   * Pricing list to import into. Omitted = the branch's default (Walk-in)
   * list — always ensured to exist first, regardless of `listId`. Must belong
   * to the caller's branch.
   */
  @IsOptional()
  @IsUUID()
  listId?: string;
}
