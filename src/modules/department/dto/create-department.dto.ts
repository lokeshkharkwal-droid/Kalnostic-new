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

export class CreateDepartmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  // NOTE: `code` is NOT accepted from the client — it is system-generated
  // (`{INITIALS}-Dep-{n}`, per-tenant sequential) and immutable. See
  // DepartmentService.

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // "Module mapping" — reuses the same enum as Branch.branchType.
  @IsArray()
  @IsEnum(BranchType, { each: true })
  @ArrayUnique()
  moduleMapping: BranchType[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => DepartmentPersonMappingDto)
  personMappings?: DepartmentPersonMappingDto[];
}
