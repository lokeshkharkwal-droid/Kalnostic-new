import { BranchType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DepartmentPersonMappingDto } from './department-person-mapping.dto';

/**
 * All fields optional; mirrors CreateDepartmentDto (explicit optionals, not
 * `PartialType`). `code` is immutable and never accepted here. When
 * `personMappings` is provided it REPLACES the full set (existing active rows
 * are soft-deleted and re-created) — see DepartmentService.update.
 */
export class UpdateDepartmentDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @IsOptional()
  @IsEnum(BranchType, { each: true })
  @ArrayUnique()
  moduleMapping?: BranchType[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => DepartmentPersonMappingDto)
  personMappings?: DepartmentPersonMappingDto[];
}
