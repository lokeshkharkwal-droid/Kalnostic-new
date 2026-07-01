import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Payload to create a country. */
export class CreateCountryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  /** Short country code, e.g. ISO 3166-1 alpha-2/3 ("IN", "IND"). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
