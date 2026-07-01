import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Partial update for a country. Fields are individually optional (SKILL.md §4 —
 * no `PartialType`). A country has no parent, so nothing here re-parents it.
 */
export class UpdateCountryDto {
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
