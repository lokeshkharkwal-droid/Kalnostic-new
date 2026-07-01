import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Payload to create a state under a country. */
export class CreateStateDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code: string;

  /** Parent country — validated against the location master in the service. */
  @IsUUID()
  countryId: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
