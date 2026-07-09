import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Sync payload. `branchLabPanelIds` optionally restricts the re-snapshot to a
 * subset of the branch's Lab Panel List; omit it to sync every copy. Sync reloads
 * each copy's source Master Data panel (via `sourceLabPanelId`), OVERWRITES the
 * copy's fields, and rebuilds its member tests from the source composition —
 * branch-level edits are discarded.
 */
export class SyncBranchLabPanelsDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchLabPanelIds?: string[];
}
