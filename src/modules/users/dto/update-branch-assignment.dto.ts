import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { StaffStatus } from '@prisma/client';
import { STAFF_ROLE_KEYS } from '../../permissions/constants/profile-registry.constant';

/**
 * Patch a single (user + branch) assignment: per-branch role, status, default
 * flag, modules and default module. All fields optional — only provided ones
 * change.
 */
export class UpdateBranchAssignmentDto {
  /** Change the role template assigned at this branch. */
  @IsIn(STAFF_ROLE_KEYS as readonly string[])
  @IsOptional()
  role?: string;

  @IsEnum(StaffStatus)
  @IsOptional()
  status?: StaffStatus;

  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (v === 'yes' || v === 'true') return true;
      if (v === 'no' || v === 'false') return false;
    }
    return value;
  })
  @IsBoolean()
  @IsOptional()
  defaultBranch?: boolean;

  /**
   * Replacement set of module keys enabled for this user at this branch.
   * Validated against the branch type + branch enablement in the service.
   */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  modules?: string[];

  /** Default landing module; must be one of `modules` and enabled for the branch. */
  @IsString()
  @IsOptional()
  defaultModule?: string;
}
