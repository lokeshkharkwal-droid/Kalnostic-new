import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Partial update for a city. Fields are individually optional (SKILL.md §4).
 * The parent `stateId`/`countryId` are intentionally NOT updatable here — the
 * hierarchy stays stable so areas keep valid ancestors.
 */
export class UpdateCityDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pinCode must be exactly 6 digits' })
  pinCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
