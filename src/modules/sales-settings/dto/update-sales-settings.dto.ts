import { IsObject } from 'class-validator';

/**
 * Update the tenant's sales settings. The settings are stored as a free-form
 * JSON `config` blob (the 9 configuration sections live inside it); the update is
 * a shallow merge over the existing config, so callers may send only the sections
 * they are changing.
 */
export class UpdateSalesSettingsDto {
  /** The settings JSON to merge into the tenant's stored config. */
  @IsObject()
  config: Record<string, unknown>;
}
