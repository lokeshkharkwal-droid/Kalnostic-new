import { BranchType, CategoryType } from '@prisma/client';
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
 * Payload for `POST /siteadmin/categories` — a SITE_ADMIN global category
 * template (no tenant/branch). Mirrors CreateCategoryDto but WITHOUT person
 * mappings and without `code` (system-generated `SA-Cat-{n}`). For
 * UNDER_DEPARTMENT, `departmentId` must reference a SITE_ADMIN department
 * template (validated in CategoryService.createTemplate).
 */
export class CreateCategoryTemplateDto {
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

  @IsEnum(CategoryType)
  categoryType: CategoryType;

  // Required only when categoryType is UNDER_DEPARTMENT; must be absent for
  // INDEPENDENT (enforced in CategoryService). Validated against SITE_ADMIN
  // department templates in the service.
  @ValidateIf(
    (o: CreateCategoryTemplateDto) =>
      o.categoryType === CategoryType.UNDER_DEPARTMENT,
  )
  @IsUUID()
  departmentId?: string;

  // "Module mapping" — reuses the same enum as Branch.branchType.
  @IsArray()
  @IsEnum(BranchType, { each: true })
  @ArrayUnique()
  moduleMapping: BranchType[];
}
