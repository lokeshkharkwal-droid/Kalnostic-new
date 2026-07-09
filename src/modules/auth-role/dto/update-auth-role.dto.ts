import { BranchType } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Partial update for a role (explicit optionals, not `PartialType`).
 *
 * For **system** roles only `description` and `isActive` are applied — any
 * attempt to change `name`/`allowedBranchTypes` is rejected
 * (`SystemRoleImmutableException`). `key` is immutable and never accepted.
 */
export class UpdateAuthRoleDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @IsOptional()
  @IsEnum(BranchType, { each: true })
  @ArrayUnique()
  allowedBranchTypes?: BranchType[];
}
