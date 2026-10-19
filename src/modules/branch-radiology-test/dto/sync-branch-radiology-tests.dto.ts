import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Sync payload. `branchRadiologyTestIds` optionally restricts the re-snapshot to
 * a subset of the branch's Radiology Test List; omit it to sync every copy in
 * the target list. Sync reloads each copy's source Master Data test (via
 * `sourceRadiologyTestId`) and OVERWRITES the copy's fields — branch-level edits
 * are discarded.
 */
export class SyncBranchRadiologyTestsDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchRadiologyTestIds?: string[];

  /**
   * Pricing list to sync. Omitted = the branch's default (Walk-in) list —
   * always ensured to exist first. Must belong to the caller's branch.
   */
  @IsOptional()
  @IsUUID()
  listId?: string;
}
