import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Sync payload. `branchLabTestIds` optionally restricts the re-snapshot to a
 * subset of the branch's Lab Test List; omit it to sync every copy. Sync reloads
 * each copy's source Master Data test (via `sourceLabTestId`) and OVERWRITES the
 * copy's fields and clinical snapshot — branch-level edits are discarded.
 */
export class SyncBranchLabTestsDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchLabTestIds?: string[];
}
