import { BranchType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
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

  // User-set dropdown prefix, unique per tenant (validated in DepartmentService).
  // The regex bounds the length (2-6), so no separate Min/MaxLength is needed.
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
