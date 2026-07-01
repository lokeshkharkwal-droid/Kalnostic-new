import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Partial update for a state. Fields are individually optional (SKILL.md §4).
 * The parent `countryId` is intentionally NOT updatable here — re-parenting a
 * state would strand its cities/areas, so the tree stays stable.
 */
export class UpdateStateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
