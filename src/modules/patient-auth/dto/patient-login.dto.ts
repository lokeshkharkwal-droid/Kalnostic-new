import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Patient-portal login. No tenant here — a patient authenticates once against
 * the platform identity, then picks a business at `select-business`
 * ("login then pick business").
 */
export class PatientLoginDto {
  /** Registered mobile or email (resolved in precedence order phone → email). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  identifier: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  password: string;
}
