import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Payload for the public `POST /contact-us` form submission. All fields are
 * required. Length caps double as light abuse protection on this unauthenticated
 * route. No `tenantId` — contact submissions are platform-level (CLAUDE.md §4.2).
 */
export class CreateContactSubmissionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  mobileNumber: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  companyName: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;
}
