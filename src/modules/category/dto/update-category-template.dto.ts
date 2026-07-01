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
} from 'class-validator';

/**
 * Partial update for a SITE_ADMIN category template — explicit optional fields
 * (not `PartialType`, per SKILL.md §4). `code` is immutable; `source`/`tenantId`
 * are fixed; no person mappings. When `categoryType`/`departmentId` is supplied
 * the parent link is re-resolved against SITE_ADMIN department templates in the
 * service (switching INDEPENDENT ↔ UNDER_DEPARTMENT is allowed).
 */
export class UpdateCategoryTemplateDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Z0-9]{2,6}$/, {
    message: 'shortName must be 2-6 uppercase letters or digits (A-Z, 0-9)',
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
  @IsOptional()
  categoryType?: CategoryType;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsArray()
  @IsOptional()
  @IsEnum(BranchType, { each: true })
  @ArrayUnique()
  moduleMapping?: BranchType[];
}
