import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Update a radiology certificate's scalar fields. All optional (explicit optional
 * fields — no `PartialType`, per SKILL.md). `tenantId`/`masterDataId` come from
 * context/path.
 */
export class UpdateRadiologyCertificateDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  groupName?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
