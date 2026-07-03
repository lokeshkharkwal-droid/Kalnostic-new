import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Persist-import payload: the ids of the Master Data lab tests (of the active
 * branch's master data) to materialize into this branch's Lab Test List. Each is
 * deep-copied as an independent snapshot; ids already imported are skipped.
 */
export class ImportBranchLabTestsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  labTestIds!: string[];
}
