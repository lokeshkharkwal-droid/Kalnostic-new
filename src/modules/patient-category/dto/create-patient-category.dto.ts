import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Create a Patient Category in the caller's tenant. `branchLabTestIds` /
 * `branchLabPanelIds` select this category's Lab Test List / Lab Panel List —
 * both are mandatory and are validated against the caller's active branch
 * (never a client-supplied branch — CLAUDE.md §4.7).
 */
export class CreatePatientCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchLabTestIds: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchLabPanelIds: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /** When true, this category becomes the tenant's default (replacing any prior default). */
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
