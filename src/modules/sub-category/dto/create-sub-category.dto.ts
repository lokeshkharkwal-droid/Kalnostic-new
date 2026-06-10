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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SubCategoryPersonMappingDto } from './sub-category-person-mapping.dto';

export class CreateSubCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  // User-set dropdown prefix, unique within the parent category/department (or
  // per tenant for INDEPENDENT) — validated in SubCategoryService. The regex
  // bounds the length (2-6), so no separate Min/MaxLength is needed.
  @IsString()
  @Matches(/^[A-Z0-9]{2,6}$/, {
    message: 'shortName must be 2-6 uppercase letters or digits (A-Z, 0-9)',
  })
  shortName: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  // NOTE: `code` is NOT accepted from the client — it is system-generated
  // (`{INITIALS}-SubCat-{n}`, per-tenant sequential) and immutable. See
  // SubCategoryService.

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsEnum(SubCategoryType)
  subCategoryType: SubCategoryType;

  // Required only when subCategoryType is UNDER_DEPARTMENT; must be absent for
  // the other types (enforced in SubCategoryService). Validated against the
  // caller's tenant in the service.
  @ValidateIf(
    (o: CreateSubCategoryDto) =>
      o.subCategoryType === SubCategoryType.UNDER_DEPARTMENT,
  )
  @IsUUID()
  departmentId?: string;

  // Required only when subCategoryType is UNDER_CATEGORY; must be absent for
  // the other types (enforced in SubCategoryService). Validated against the
  // caller's tenant in the service.
  @ValidateIf(
    (o: CreateSubCategoryDto) =>
      o.subCategoryType === SubCategoryType.UNDER_CATEGORY,
  )
  @IsUUID()
  categoryId?: string;

  // "Module mapping" — reuses the same enum as Branch.branchType.
  @IsArray()
  @IsEnum(BranchType, { each: true })
  @ArrayUnique()
  moduleMapping: BranchType[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SubCategoryPersonMappingDto)
  personMappings?: SubCategoryPersonMappingDto[];
}
