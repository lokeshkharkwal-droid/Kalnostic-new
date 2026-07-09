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
 * Payload to create a **custom** role in the caller's tenant.
 *
 * `key` is NOT accepted from the client — it is system-generated (a slug of the
 * name, deduplicated per tenant) and immutable, mirroring how department `code`
 * is minted. System roles are seeded, never created through this endpoint.
 * An empty (or omitted) `allowedBranchTypes` makes the role tenant-level.
 */
export class CreateAuthRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /** Branch types this role may be assigned at. Empty = tenant-level role. */
  @IsArray()
  @IsOptional()
  @IsEnum(BranchType, { each: true })
  @ArrayUnique()
  allowedBranchTypes?: BranchType[];
}
