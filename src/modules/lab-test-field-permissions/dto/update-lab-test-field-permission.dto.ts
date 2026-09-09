import { IsObject } from 'class-validator';

/**
 * Save (patch) the tenant's Lab Test Master Setting field permissions.
 * `config` is `{ [section]: { [field]: boolean } }` — only the sections/fields
 * being changed need to be included; anything omitted keeps its current value
 * (or the Allowed default if never set). Shape is validated leniently here
 * (`@IsObject()`) and strictly reconciled against the known section/field
 * registry in `LabTestFieldPermissionsService.saveForTenant`.
 */
export class UpdateLabTestFieldPermissionDto {
  @IsObject()
  config: Record<string, Record<string, boolean>>;
}
