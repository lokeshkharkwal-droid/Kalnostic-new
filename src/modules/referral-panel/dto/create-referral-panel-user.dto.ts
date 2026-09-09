import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Gender } from '@prisma/client';
import { VALIDATION_PATTERNS } from '../../../common/constants/validation-patterns.constant';

/**
 * Body for `POST /referral-panels/:id/user`. Only the standard personal + login
 * fields — branch, role, default-branch, default-module, modules and status are
 * assigned by the server from the panel and the fixed B2B role. Validation
 * mirrors `CreateUserDto` (same shared patterns) so error envelopes stay
 * consistent with the main user-creation flow.
 */
export class CreateReferralPanelUserDto {
  @Matches(VALIDATION_PATTERNS.ALPHA_SPACES, {
    message: 'employeeName may contain letters and spaces only',
  })
  @MaxLength(100)
  employeeName: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(VALIDATION_PATTERNS.USERNAME, {
    message:
      'username may contain lowercase letters, digits, dot and underscore only',
  })
  @MaxLength(50)
  username: string;

  @IsDateString()
  dateOfBirth: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsEmail()
  email: string;

  @Matches(VALIDATION_PATTERNS.INDIAN_MOBILE, {
    message: 'mobileNumber must be a valid 10-digit Indian mobile number',
  })
  mobileNumber: string;

  @Matches(VALIDATION_PATTERNS.STRONG_PASSWORD, {
    message:
      'password must be at least 8 characters and include upper, lower, digit and special characters',
  })
  password: string;

  @IsString()
  @MaxLength(300)
  @IsOptional()
  address?: string;
}
