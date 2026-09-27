import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Persist-import payload: the ids of the Master Data opd panels (of the active
 * branch's master data) to materialize into this branch's Opd Panel List. Each
 * panel and its member tests are deep-copied; panels already imported are skipped.
 */
export class ImportBranchOpdPanelsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  labPanelIds!: string[];

  /**
   * Pricing list to import into. Omitted = the branch's default (Walk-in) panel list.
   * Must belong to the caller's branch.
   */
  @IsOptional()
  @IsUUID()
  listId?: string;
}
