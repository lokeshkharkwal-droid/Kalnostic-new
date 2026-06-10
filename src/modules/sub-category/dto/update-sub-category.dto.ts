import { BranchType, SubCategoryType } from '@prisma/client';
import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { SubCategoryPersonMappingDto } from './sub-category-person-mapping.dto';

/**
 * All fields optional; mirrors CreateSubCategoryDto (explicit optionals, not
 * `PartialType`). `code` is immutable and never accepted here. When
 * `personMappings` is provided it REPLACES the full set (existing active rows
 * are soft-deleted and re-created) — see SubCategoryService.update.
 *
 * `subCategoryType`, `departmentId`, and `categoryId` may all change here; the
 * resulting parent link is re-validated in the service (INDEPENDENT ⇒ no
 * parent; UNDER_DEPARTMENT ⇒ a valid active department of the tenant;
 * UNDER_CATEGORY ⇒ a valid active category of the tenant).
 */
export class UpdateSubCategoryDto {
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

  @IsEnum(SubCategoryType)
  @IsOptional()
  subCategoryType?: SubCategoryType;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsArray()
  @IsOptional()
  @IsEnum(BranchType, { each: true })
  @ArrayUnique()
  moduleMapping?: BranchType[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SubCategoryPersonMappingDto)
  personMappings?: SubCategoryPersonMappingDto[];
}
