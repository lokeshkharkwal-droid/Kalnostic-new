import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Update a lab adapter. All fields optional (explicit optional mirror — no
 * `PartialType`, per SKILL.md §4). When `branchIds` or `labTestIds` is provided,
 * that whole set is **replaced** (old active rows soft-deleted, the new set
 * created). Omitting a set leaves it untouched. `token` is immutable; `tenantId`
 * comes from context, never the body.
 */
export class UpdateLabAdapterDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsUUID('4')
  equipmentId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayUnique()
  branchIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayUnique()
  labTestIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
