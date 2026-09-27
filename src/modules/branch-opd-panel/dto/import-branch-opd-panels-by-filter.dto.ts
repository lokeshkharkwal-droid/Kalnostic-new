import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * "Select all" import payload: the same search/classification filters as the
 * import-picker's "Available to Add" listing — no client-supplied id list. Panels
 * have no sub-category (unlike opd tests).
 */
export class ImportBranchOpdPanelsByFilterDto {
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

  /**
   * Pricing list to import into. Omitted = the branch's default (Walk-in) panel list.
   * Must belong to the caller's branch.
   */
  @IsOptional()
  @IsUUID()
  listId?: string;
}
