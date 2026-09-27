import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Re-pull previously-imported opd tests from their SITE_ADMIN templates.
 * Scoped to one master data. `labTestIds` optionally narrows the sync; when omitted,
 * every imported test (`clonedFromId != null`) in the master data is synced.
 */
export class SyncOpdTestTemplatesDto {
  @IsUUID()
  masterDataId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  labTestIds?: string[];
}
