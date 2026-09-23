import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Persist-import payload: the ids of the Master Data lab panels (of the active
 * branch's master data) to materialize into this branch's Lab Panel List. Each
 * panel and its member tests are deep-copied as independent snapshots; panels
 * already imported (in the target list) are skipped.
 */
export class ImportBranchLabPanelsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  labPanelIds!: string[];

  /**
   * Pricing list to import into. Omitted = the branch's default (Walk-in)
   * panel list — always ensured to exist first, regardless of `listId`. Must
   * belong to the caller's branch.
   */
  @IsOptional()
  @IsUUID()
  listId?: string;
}
