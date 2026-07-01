import { BranchType, SubCategoryType } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Payload for `POST /siteadmin/sub-categories` — a SITE_ADMIN global
 * sub-category template (no tenant/branch). Mirrors CreateSubCategoryDto but
 * WITHOUT person mappings and without `code` (system-generated `SA-SubCat-{n}`).
 * For UNDER_DEPARTMENT / UNDER_CATEGORY the parent must reference a SITE_ADMIN
 * department / category template (validated in SubCategoryService.createTemplate).
 */
export class CreateSubCategoryTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsString()
  @Matches(/^[A-Z0-9]{2,6}$/, {
    message: 'shortName must be 2-6 uppercase letters or digits (A-Z, 0-9)',
  })
  shortName: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsEnum(SubCategoryType)
  subCategoryType: SubCategoryType;

  // Required only when subCategoryType is UNDER_DEPARTMENT; must be absent for
  // the other types. Validated against SITE_ADMIN department templates.
  @ValidateIf(
    (o: CreateSubCategoryTemplateDto) =>
      o.subCategoryType === SubCategoryType.UNDER_DEPARTMENT,
  )
  @IsUUID()
  departmentId?: string;

  // Required only when subCategoryType is UNDER_CATEGORY; must be absent for the
  // other types. Validated against SITE_ADMIN category templates.
  @ValidateIf(
    (o: CreateSubCategoryTemplateDto) =>
      o.subCategoryType === SubCategoryType.UNDER_CATEGORY,
  )
  @IsUUID()
  categoryId?: string;

  // "Module mapping" — reuses the same enum as Branch.branchType.
  @IsArray()
  @IsEnum(BranchType, { each: true })
  @ArrayUnique()
  moduleMapping: BranchType[];
}
