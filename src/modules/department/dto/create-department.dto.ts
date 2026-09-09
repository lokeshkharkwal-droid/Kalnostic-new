import { BranchType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MODULE_MAPPING_BRANCH_TYPES } from '../../../common/constants/module-mapping.constant';
import { DepartmentPersonMappingDto } from './department-person-mapping.dto';

export class CreateDepartmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  // User-set dropdown prefix, unique per tenant (validated in DepartmentService).
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

  // NOTE: `code` is NOT accepted from the client — it is system-generated
  // (`{INITIALS}-Dep-{n}`, per-tenant sequential) and immutable. See
  // DepartmentService.

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // "Module mapping" — a curated subset of Branch.branchType. Only the seven
  // supported modules are accepted (see MODULE_MAPPING_BRANCH_TYPES).
  @IsArray()
  @IsIn(MODULE_MAPPING_BRANCH_TYPES, { each: true })
  @ArrayUnique()
  moduleMapping: BranchType[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => DepartmentPersonMappingDto)
  personMappings?: DepartmentPersonMappingDto[];
}
