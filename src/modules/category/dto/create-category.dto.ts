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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CategoryPersonMappingDto } from './category-person-mapping.dto';

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  // User-set dropdown prefix, unique within the parent department (or per tenant
  // for INDEPENDENT categories) — validated in CategoryService. The regex bounds
  // the length (2-6), so no separate Min/MaxLength is needed.
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
  // (`{INITIALS}-Cat-{n}`, per-tenant sequential) and immutable. See
  // CategoryService.

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsEnum(CategoryType)
  categoryType: CategoryType;

  // Required only when categoryType is UNDER_DEPARTMENT; must be absent for
  // INDEPENDENT (enforced in CategoryService). Validated against the caller's
  // tenant in the service.
  @ValidateIf(
    (o: CreateCategoryDto) => o.categoryType === CategoryType.UNDER_DEPARTMENT,
  )
  @IsUUID()
  departmentId?: string;

  // "Module mapping" — reuses the same enum as Branch.branchType.
  @IsArray()
  @IsEnum(BranchType, { each: true })
  @ArrayUnique()
  moduleMapping: BranchType[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CategoryPersonMappingDto)
  personMappings?: CategoryPersonMappingDto[];
}
