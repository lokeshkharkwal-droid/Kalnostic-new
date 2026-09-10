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
 * Body for `PATCH /referral-panels/:id/user`. Every field is optional — only the
 * eight editable personal/login fields may change; branch, role, modules, default
 * flags and status remain server-controlled and are never accepted here.
 * Validation mirrors the create DTO so error envelopes stay consistent.
 */
export class UpdateReferralPanelUserDto {
  @IsOptional()
  @Matches(VALIDATION_PATTERNS.ALPHA_SPACES, {
    message: 'employeeName may contain letters and spaces only',
  })
  @MaxLength(100)
  employeeName?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(VALIDATION_PATTERNS.USERNAME, {
    message:
      'username may contain lowercase letters, digits, dot and underscore only',
  })
  @MaxLength(50)
  username?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(VALIDATION_PATTERNS.INDIAN_MOBILE, {
    message: 'mobileNumber must be a valid 10-digit Indian mobile number',
  })
  mobileNumber?: string;

  @IsOptional()
  @Matches(VALIDATION_PATTERNS.STRONG_PASSWORD, {
    message:
      'password must be at least 8 characters and include upper, lower, digit and special characters',
  })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}
