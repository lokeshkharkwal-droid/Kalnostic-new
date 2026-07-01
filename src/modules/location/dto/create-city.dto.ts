import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Payload to create a city under a state (and its country). */
export class CreateCityDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  /** Indian PIN code — exactly 6 digits. */
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pinCode must be exactly 6 digits' })
  pinCode: string;

  /** Parent state — validated against the location master in the service. */
  @IsUUID()
  stateId: string;

  /**
   * Denormalized parent country — must match the parent state's country
   * (enforced in the service).
   */
  @IsUUID()
  countryId: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
