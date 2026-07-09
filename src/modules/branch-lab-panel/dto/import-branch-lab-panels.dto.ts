import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Persist-import payload: the ids of the Master Data lab panels (of the active
 * branch's master data) to materialize into this branch's Lab Panel List. Each
 * panel and its member tests are deep-copied as independent snapshots; panels
 * already imported are skipped.
 */
export class ImportBranchLabPanelsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  labPanelIds!: string[];
}
