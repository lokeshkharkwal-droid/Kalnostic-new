import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Re-pull previously-imported radiology tests from their SITE_ADMIN templates.
 * Scoped to one master data (validated against the caller's tenant).
 * `radiologyTestIds` optionally narrows the sync to specific tenant tests; when
 * omitted, every imported test (`clonedFromId != null`) in the master data is
 * synced.
 */
export class SyncRadiologyTestTemplatesDto {
  /** Master data whose imported tests should be synced. */
  @IsUUID()
  masterDataId: string;

  /** Optional subset of tenant radiology-test ids to sync (max 500, de-duplicated). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  radiologyTestIds?: string[];
}
