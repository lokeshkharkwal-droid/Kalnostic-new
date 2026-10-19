import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Re-pull previously-imported radiology panels from their SITE_ADMIN templates.
 * Scoped to one master data (validated against the caller's tenant).
 * `radiologyPanelIds` optionally narrows the sync to specific tenant panels; when
 * omitted, every imported panel (`clonedFromId != null`) in the master data is
 * synced.
 */
export class SyncRadiologyPanelTemplatesDto {
  /** Master data whose imported panels should be synced. */
  @IsUUID()
  masterDataId: string;

  /** Optional subset of tenant radiology-panel ids to sync (max 500, de-duplicated). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  radiologyPanelIds?: string[];
}
