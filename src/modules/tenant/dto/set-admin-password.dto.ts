import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

/**
 * Payload to set the business admin's login password to a SiteAdmin-chosen
 * value (edit flow). Policy mirrors {@link CreateTenantDto.adminPassword}:
 * min 8 chars, ≥1 uppercase, ≥1 digit (§5.3). Stored bcrypt-hashed and marked
 * as a non-temp password.
 */
export class SetAdminPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'adminPassword must be at least 8 characters long' })
  @Matches(/[A-Z]/, {
    message: 'adminPassword must contain at least one uppercase letter',
  })
  @Matches(/[0-9]/, {
    message: 'adminPassword must contain at least one number',
  })
  adminPassword: string;
}
