import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Patient self-service password change. The new password is checked against the
 * shared policy in `PasswordService.validate` (≥8 chars, ≥1 upper, ≥1 digit) in
 * the service — DTOs don't hand-roll that check.
 */
export class ChangePatientPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  newPassword: string;
}
