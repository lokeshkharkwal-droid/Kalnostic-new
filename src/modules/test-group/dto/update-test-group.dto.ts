import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Partial update for a test group — explicit optional fields (not `PartialType`;
 * SKILL.md §4). When `labTestIds` is provided the whole mapping set is REPLACED
 * (old active mappings soft-deleted, the new set created); omit it to leave the
 * current mappings untouched.
 */
export class UpdateTestGroupDto {
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(255)
  groupName?: string;

  /** Replacement set of SITE_ADMIN lab-test template ids for the group. */
  @IsArray()
  @IsOptional()
  @IsUUID('4', { each: true })
  labTestIds?: string[];
}
