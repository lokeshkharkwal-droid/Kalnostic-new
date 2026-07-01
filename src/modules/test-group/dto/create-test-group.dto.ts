import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Create a test group. `groupName` is required and unique among active groups.
 * `labTestIds` is an optional set of SITE_ADMIN lab-test template ids to map to
 * the group — validated (existence + no duplicates) in `TestGroupService`; the
 * mappings are persisted in `TestGroupMapping` in the same transaction.
 */
export class CreateTestGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  groupName: string;

  /** SITE_ADMIN lab-test template ids to include in the group. */
  @IsArray()
  @IsOptional()
  @IsUUID('4', { each: true })
  labTestIds?: string[];
}
