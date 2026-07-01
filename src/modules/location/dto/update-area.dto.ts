import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Partial update for an area. Fields are individually optional (SKILL.md §4).
 * The parent `cityId`/`stateId`/`countryId` are intentionally NOT updatable here
 * so the location hierarchy stays stable.
 */
export class UpdateAreaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  locality?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
