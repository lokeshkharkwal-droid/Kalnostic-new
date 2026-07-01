import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Payload to create an area/locality under a city (and its state + country). */
export class CreateAreaDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  locality: string;

  /** Parent city — validated against the location master in the service. */
  @IsUUID()
  cityId: string;

  /** Denormalized parent state — must match the parent city's state. */
  @IsUUID()
  stateId: string;

  /** Denormalized parent country — must match the parent city's country. */
  @IsUUID()
  countryId: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
