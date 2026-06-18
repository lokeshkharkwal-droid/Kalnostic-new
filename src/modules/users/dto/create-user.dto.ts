import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BloodGroup, Gender, StaffStatus, UserType } from '@prisma/client';
import { STAFF_ROLE_KEYS } from '../../permissions/constants/profile-registry.constant';
import { VALIDATION_PATTERNS } from '../../../common/constants/validation-patterns.constant';

/**
 * A single branch assignment supplied when creating a user or via Assign
 * Branches: `{ branchId, roleKey, moduleId? }`. The role (role template) is chosen
 * **per branch** — one role per branch. `moduleId` is the module linked to this
 * assignment (stored on the `default_module_id` column).
 */
export class BranchAssignmentItemDto {
  @IsString()
  branchId: string;

  /** Role template assigned at this branch (one role per branch). */
  @IsIn(STAFF_ROLE_KEYS as readonly string[])
  roleKey: string;

  /** Module linked to this assignment (must be enabled for the branch). */
  @IsString()
  @IsOptional()
  moduleId?: string;

  /** Marks this branch as the user's default. Exactly one default is allowed. */
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  /** Per-branch activation status (defaults to ACTIVE). */
  @IsEnum(StaffStatus)
  @IsOptional()
  branchStatus?: StaffStatus;
}

/**
 * Create a staff user (User Management v2.0). Identity lands on the platform
 * Person; employment (user code, type, role, status) on the tenant membership;
 * credentials on PersonCredentials; branch assignments on UserBranchProfile.
 */
export class CreateUserDto {
  // ── Profile information ──
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

  // ── Contact information ──
  @IsEmail()
  email: string;

  @Matches(VALIDATION_PATTERNS.INDIAN_MOBILE, {
    message: 'mobileNumber must be a valid 10-digit Indian mobile number',
  })
  mobileNumber: string;

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

  // ── Login & access ──
  @Matches(VALIDATION_PATTERNS.STRONG_PASSWORD, {
    message:
      'password must be at least 8 characters and include upper, lower, digit and special characters',
  })
  password: string;

  /**
   * Optional primary/default role for the membership. The authoritative role is
   * assigned per-branch (see `branches[].roleKey`); a user may be created with no
   * role and assigned to branches later.
   */
  @IsIn(STAFF_ROLE_KEYS as readonly string[])
  @IsOptional()
  roleKey?: string;

  @IsEnum(UserType)
  userType: UserType;

  /** Global account status (defaults to ACTIVE). */
  @IsEnum(StaffStatus)
  @IsOptional()
  status?: StaffStatus;

  // ── Optional initial branch assignments ──
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchAssignmentItemDto)
  @IsOptional()
  branches?: BranchAssignmentItemDto[];
}

/**
 * Bulk branch assignment payload (Assign Branches API). Exactly one item may be
 * the default; the role is taken from the user's membership.
 */
export class AssignBranchesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BranchAssignmentItemDto)
  branches: BranchAssignmentItemDto[];
}
