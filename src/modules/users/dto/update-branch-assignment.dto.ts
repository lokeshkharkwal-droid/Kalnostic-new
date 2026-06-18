import { IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { StaffStatus } from '@prisma/client';
import { STAFF_ROLE_KEYS } from '../../permissions/constants/profile-registry.constant';

/**
 * Patch a single (user + branch) assignment: per-branch role, status, default
 * flag, and module. All fields optional — only provided ones change.
 */
export class UpdateBranchAssignmentDto {
  /** Change the role template assigned at this branch. */
  @IsIn(STAFF_ROLE_KEYS as readonly string[])
  @IsOptional()
  roleKey?: string;

  @IsEnum(StaffStatus)
  @IsOptional()
  branchStatus?: StaffStatus;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  /** Module linked to this assignment; must be enabled for the branch. */
  @IsString()
  @IsOptional()
  moduleId?: string;
}
