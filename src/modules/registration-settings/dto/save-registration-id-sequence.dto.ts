import {
  RegistrationIdResetCycle,
  RegistrationIdSeparator,
} from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Save/upsert payload for one `RegistrationIdSequence` row (Order/Quotation/
 * Appointment/Patient-UMID). All fields optional (partial patch). The running
 * counter (`currentNumber`) is system-managed and never accepted from a
 * client.
 */
export class SaveRegistrationIdSequenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(24)
  @Matches(/^[A-Za-z0-9]*$/, {
    message: 'prefix may only contain letters and digits',
  })
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  @Matches(/^[A-Za-z0-9]*$/, {
    message: 'suffix may only contain letters and digits',
  })
  suffix?: string;

  @IsOptional()
  @IsEnum(RegistrationIdSeparator)
  separator?: RegistrationIdSeparator;

  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(10)
  numberLength?: number;

  @IsOptional()
  @IsEnum(RegistrationIdResetCycle)
  resetCycle?: RegistrationIdResetCycle;
}
