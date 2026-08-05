import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Re-pull previously-imported lab tests from their SITE_ADMIN templates. Scoped
 * to one master data (validated against the caller's tenant). `labTestIds`
 * optionally narrows the sync to specific tenant tests; when omitted, every
 * imported test (`clonedFromId != null`) in the master data is synced.
 */
export class SyncLabTestTemplatesDto {
  /** Master data whose imported tests should be synced. */
  @IsUUID()
  masterDataId: string;

  /** Optional subset of tenant lab-test ids to sync (max 500, de-duplicated). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  labTestIds?: string[];
}
