import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Partial update for a master data. Explicit optional fields (not `PartialType`,
 * which the project does not use — see SKILL.md §4). `branchId` is immutable and
 * never accepted here.
 */
export class UpdateMasterDataDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;
}
