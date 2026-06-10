import { BranchType, CategoryType } from '@prisma/client';
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
import { CategoryPersonMappingDto } from './category-person-mapping.dto';

/**
 * All fields optional; mirrors CreateCategoryDto (explicit optionals, not
 * `PartialType`). `code` is immutable and never accepted here. When
 * `personMappings` is provided it REPLACES the full set (existing active rows
 * are soft-deleted and re-created) — see CategoryService.update.
 *
 * `categoryType` and `departmentId` may both change here; the resulting link is
 * re-validated in the service (INDEPENDENT ⇒ no department; UNDER_DEPARTMENT ⇒
 * a valid active department of the tenant).
 */
export class UpdateCategoryDto {
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

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CategoryPersonMappingDto)
  personMappings?: CategoryPersonMappingDto[];
}
