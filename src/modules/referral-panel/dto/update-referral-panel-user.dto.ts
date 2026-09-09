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
 * Body for `PATCH /referral-panels/:id/user`. Only the same basic-profile
 * fields the create form offers, all optional (partial update) — branch,
 * role, permissions/modules, status and `username` are server-controlled and
 * intentionally absent here (mirrors `UpdateUserDto`'s immutable-username
 * convention; unlike `UpdateUserDto`, `email` IS editable, since a B2B login
 * authenticates by `username`, not `email` — see `ReferralPanelUserService.update`).
 */
export class UpdateReferralPanelUserDto {
  @Matches(VALIDATION_PATTERNS.ALPHA_SPACES, {
    message: 'employeeName may contain letters and spaces only',
  })
  @MaxLength(100)
  @IsOptional()
  employeeName?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @IsEmail()
  @IsOptional()
  email?: string;

  @Matches(VALIDATION_PATTERNS.INDIAN_MOBILE, {
    message: 'mobileNumber must be a valid 10-digit Indian mobile number',
  })
  @IsOptional()
  mobileNumber?: string;

  @Matches(VALIDATION_PATTERNS.STRONG_PASSWORD, {
    message:
      'password must be at least 8 characters and include upper, lower, digit and special characters',
  })
  @IsOptional()
  password?: string;

  @IsString()
  @MaxLength(300)
  @IsOptional()
  address?: string;
}
