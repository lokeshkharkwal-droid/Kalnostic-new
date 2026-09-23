import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Persist-import payload: the ids of the Master Data lab tests (of the active
 * branch's master data) to materialize into this branch's Lab Test List. Each is
 * deep-copied as an independent snapshot; ids already imported (in the target
 * list) are skipped.
 */
export class ImportBranchLabTestsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  labTestIds!: string[];

  /**
   * Pricing list to import into. Omitted = the branch's default (Walk-in)
   * list — always ensured to exist first, regardless of `listId`. Must belong
   * to the caller's branch.
   */
  @IsOptional()
  @IsUUID()
  listId?: string;
}
