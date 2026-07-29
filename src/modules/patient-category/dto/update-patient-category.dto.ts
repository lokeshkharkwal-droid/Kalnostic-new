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
 * All fields optional; mirrors CreatePatientCategoryDto (explicit optionals,
 * not `PartialType`). When `branchLabTestIds`/`branchLabPanelIds` is provided
 * it REPLACES the category's whole Lab Test List / Lab Panel List for the
 * caller's active branch — see PatientCategoryService.update.
 */
export class UpdatePatientCategoryDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsArray()
  @IsOptional()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchLabTestIds?: string[];

  @IsArray()
  @IsOptional()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchLabPanelIds?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /** When true, this category becomes the tenant's default (replacing any prior default). */
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
