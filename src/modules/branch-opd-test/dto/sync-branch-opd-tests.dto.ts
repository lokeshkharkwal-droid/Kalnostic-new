import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Sync payload. `branchTestIds` optionally restricts the re-snapshot to a subset of
 * the branch's Opd Test List; omit it to sync every copy in the target list.
 * Sync reloads each copy's source Master Data test (via `sourceTestId`) and
 * OVERWRITES the copy's fields and clinical snapshot — branch-level edits are discarded.
 */
export class SyncBranchOpdTestsDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchTestIds?: string[];

  /**
   * Pricing list to sync. Omitted = the branch's default (Walk-in) list. Must belong
   * to the caller's branch.
   */
  @IsOptional()
  @IsUUID()
  listId?: string;
}
