import {
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { STAFF_ROLE_KEYS } from '../../permissions/constants/profile-registry.constant';
import { VALIDATION_PATTERNS } from '../../../common/constants/validation-patterns.constant';

/**
 * Body for the **quick staff-add** flow (`POST /users/quick-staff`) used by the
 * Create-Order page's Radiologist/Phlebotomist "+" buttons. It creates a real
 * staff Person (identity + auto-generated login credentials) assigned to the
 * **active branch** (from the JWT — never the body) with the chosen `role` and
 * `modules`. Only the handful of fields collected in-flow are accepted; the full
 * staff profile (DOB, password, address, …) is completed later by the Branch
 * Admin via the User Management screens.
 */
export class CreateQuickStaffDto {
  /** The role to assign at the active branch (one of the staff role keys). */
  @IsIn(STAFF_ROLE_KEYS as readonly string[])
  role: string;

  /** Display name; split into first/last on the Person. */
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @Matches(VALIDATION_PATTERNS.INDIAN_MOBILE)
  @IsOptional()
  mobileNumber?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  email?: string;

  /**
   * Optional override of the module keys enabled at the branch. When omitted,
   * the service applies a sensible per-role default (e.g. phlebotomist →
   * `phlebotomist`, `registration`, `accession`).
   */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  modules?: string[];
}
