import { BranchType } from '@prisma/client';
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
} from 'class-validator';

/**
 * Partial update for a SITE_ADMIN department template — explicit optional fields
 * (not `PartialType`, per SKILL.md §4). `code` is immutable and never accepted;
 * `source`/`tenantId` are fixed. No person mappings (templates carry no staff).
 */
export class UpdateDepartmentTemplateDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  // Nullable so the client can explicitly clear a previously-set short name
  // (omitting the field entirely means "leave unchanged").
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z][a-zA-Z0-9]{1,5}$/, {
    message:
      'shortName must be 2-6 characters starting with an uppercase letter (A-Z)',
  })
  shortName?: string | null;

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
}
