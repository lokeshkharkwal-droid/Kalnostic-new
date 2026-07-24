import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Create a lab equipment. `name` is required and unique among active equipment.
 * `code` (adapter code), `description`, and the three rich-text HTML documents
 * are optional. `labTestIds` is an optional set of SITE_ADMIN lab-test template
 * ids the equipment processes — validated (existence + no duplicates) in
 * `EquipmentService`; the mappings are persisted in `EquipmentLabTest` in the
 * same transaction.
 */
export class CreateEquipmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  /** Adapter code (e.g. a slug of the name). Optional, free-text. */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** Rich-text (HTML) setup document. */
  @IsString()
  @IsOptional()
  setupDocument?: string;

  /** Rich-text (HTML) lab-config document. */
  @IsString()
  @IsOptional()
  labConfigDocument?: string;

  /** Rich-text (HTML) adopter document. */
  @IsString()
  @IsOptional()
  adopterDocument?: string;

  /** SITE_ADMIN lab-test template ids the equipment processes. */
  @IsArray()
  @IsOptional()
  @IsUUID('4', { each: true })
  labTestIds?: string[];
}
