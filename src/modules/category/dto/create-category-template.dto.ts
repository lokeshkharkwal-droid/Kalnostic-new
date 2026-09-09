import { BranchType, CategoryType } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { MODULE_MAPPING_BRANCH_TYPES } from '../../../common/constants/module-mapping.constant';

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

  // Optional; if provided must be 2-6 chars starting with an uppercase letter.
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z][a-zA-Z0-9]{1,5}$/, {
    message:
      'shortName must be 2-6 characters starting with an uppercase letter (A-Z)',
  })
  shortName?: string;

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

  // "Module mapping" — a curated subset of Branch.branchType. Only the seven
  // supported modules are accepted (see MODULE_MAPPING_BRANCH_TYPES).
  @IsArray()
  @IsIn(MODULE_MAPPING_BRANCH_TYPES, { each: true })
  @ArrayUnique()
  moduleMapping: BranchType[];
}
