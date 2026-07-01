import { DoctorAvailability, DoctorBranchRole } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * One branch assignment for a doctor: the branch, the doctor's role and
 * availability there, whether it is the doctor's primary branch, and the
 * per-branch charges. `branchId` is validated against the caller's tenant in
 * DoctorsService (never trusted from the body — CLAUDE.md §4.7). Fees default to
 * 0. At most one assignment per doctor may be `isPrimary` (enforced in the
 * service).
 */
export class DoctorBranchAssignmentDto {
  @IsUUID()
  branchId: string;

  @IsEnum(DoctorBranchRole)
  branchRole: DoctorBranchRole;

  @IsEnum(DoctorAvailability)
  availability: DoctorAvailability;

  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;

  // ── Per-branch charges (default 0; up to 2 decimal places) ──
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  consultationFee?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  emergencyFee?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  followUpFee?: number;

  @IsBoolean()
  @IsOptional()
  isAllowDiscount?: boolean;
}
