import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Partial update for a lab equipment — explicit optional fields (not
 * `PartialType`; SKILL.md §4). Provided scalar fields are patched. When
 * `labTestIds` is provided the whole mapping set is REPLACED (old active mappings
 * soft-deleted, the new set created); omit it to leave the current mappings
 * untouched.
 */
export class UpdateEquipmentDto {
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  setupDocument?: string;

  @IsString()
  @IsOptional()
  labConfigDocument?: string;

  @IsString()
  @IsOptional()
  adopterDocument?: string;

  /** Replacement set of SITE_ADMIN lab-test template ids for the equipment. */
  @IsArray()
  @IsOptional()
  @IsUUID('4', { each: true })
  labTestIds?: string[];
}
