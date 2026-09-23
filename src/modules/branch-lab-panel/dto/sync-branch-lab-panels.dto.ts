import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Sync payload. `branchLabPanelIds` optionally restricts the re-snapshot to a
 * subset of the branch's Lab Panel List; omit it to sync every copy in the
 * target list. Sync reloads each copy's source Master Data panel (via
 * `sourceLabPanelId`), OVERWRITES the copy's fields, and rebuilds its member
 * tests from the source composition — branch-level edits are discarded.
 */
export class SyncBranchLabPanelsDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchLabPanelIds?: string[];

  /**
   * Pricing list to sync. Omitted = the branch's default (Walk-in) panel
   * list — always ensured to exist first, regardless of `listId`. Must
   * belong to the caller's branch.
   */
  @IsOptional()
  @IsUUID()
  listId?: string;
}
