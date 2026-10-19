import { IsUUID } from 'class-validator';

/**
 * Clone all active radiology panels from the source master data (the
 * `:masterDataId` path param) into the target. The service validates both belong
 * to the caller's tenant and copies each panel (plus its member-test rows,
 * remapped onto the target's tests), skipping any whose `panelName` or
 * `panelCode` already exists (active) in the target.
 */
export class CloneRadiologyPanelsDto {
  @IsUUID()
  targetMasterDataId: string;
}
