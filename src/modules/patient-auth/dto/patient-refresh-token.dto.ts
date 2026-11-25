import { IsNotEmpty, IsString } from 'class-validator';

/** Rotate a patient refresh token for a new access + refresh pair. */
export class PatientRefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
