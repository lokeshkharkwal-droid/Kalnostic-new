import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * "Select all" import payload: the same search/classification filters as the
 * import-picker's "Available to Add" listing — no client-supplied id list. The
 * backend re-resolves every Master Data opd test matching these filters
 * (excluding ones already in the target list) and imports all of them.
 */
export class ImportBranchOpdTestsByFilterDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subCategory?: string;

  /**
   * Pricing list to import into. Omitted = the branch's default (Walk-in) list.
   * Must belong to the caller's branch.
   */
  @IsOptional()
  @IsUUID()
  listId?: string;
}
