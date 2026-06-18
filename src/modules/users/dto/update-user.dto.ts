import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { BloodGroup, Gender, StaffStatus, UserType } from '@prisma/client';
import { STAFF_ROLE_KEYS } from '../../permissions/constants/profile-registry.constant';
import { VALIDATION_PATTERNS } from '../../../common/constants/validation-patterns.constant';

/**
 * Edit a staff user. `username`, `email`, and `userCode` are immutable and are
 * intentionally absent — the global ValidationPipe (`forbidNonWhitelisted`)
 * rejects them with a 400 if a client sends them. All other fields are optional.
 */
export class UpdateUserDto {
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

  @IsEnum(BloodGroup)
  @IsOptional()
  bloodGroup?: BloodGroup;

  @IsString()
  @MaxLength(60)
  @IsOptional()
  nationality?: string;

  @Matches(VALIDATION_PATTERNS.ALPHA_SPACES, {
    message: 'fatherName may contain letters and spaces only',
  })
  @MaxLength(100)
  @IsOptional()
  fatherName?: string;

  @Matches(VALIDATION_PATTERNS.ALPHA_SPACES, {
    message: 'motherName may contain letters and spaces only',
  })
  @MaxLength(100)
  @IsOptional()
  motherName?: string;

  @Matches(VALIDATION_PATTERNS.AADHAAR, {
    message: 'aadhaarNumber must be exactly 12 digits',
  })
  @IsOptional()
  aadhaarNumber?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(VALIDATION_PATTERNS.PAN, {
    message: 'panNumber must match the format AAAAA9999A',
  })
  @IsOptional()
  panNumber?: string;

  @IsString()
  @MaxLength(300)
  @IsOptional()
  address?: string;

  @Matches(VALIDATION_PATTERNS.INDIAN_MOBILE, {
    message: 'mobileNumber must be a valid 10-digit Indian mobile number',
  })
  @IsOptional()
  mobileNumber?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  emergencyContactName?: string;

  @Matches(VALIDATION_PATTERNS.INDIAN_MOBILE, {
    message:
      'emergencyContactNumber must be a valid 10-digit Indian mobile number',
  })
  @IsOptional()
  emergencyContactNumber?: string;

  /** Admins may update the password during Edit User (always editable). */
  @Matches(VALIDATION_PATTERNS.STRONG_PASSWORD, {
    message:
      'password must be at least 8 characters and include upper, lower, digit and special characters',
  })
  @IsOptional()
  password?: string;

  @IsIn(STAFF_ROLE_KEYS as readonly string[])
  @IsOptional()
  roleKey?: string;

  @IsEnum(UserType)
  @IsOptional()
  userType?: UserType;

  /** Global account status (Active/Inactive). */
  @IsEnum(StaffStatus)
  @IsOptional()
  status?: StaffStatus;
}
