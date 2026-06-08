import { BranchStatus, BranchType, DayOfWeek } from '@prisma/client';
import {
  ArrayUnique,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** 24-hour `HH:mm` clock time (branch-local), e.g. `08:30`, `19:00`. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** All branch fields optional (validation rules mirror CreateBranchDto). */
export class UpdateBranchDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsEnum(BranchType)
  @IsOptional()
  branchType?: BranchType;

  // NOTE: `code` is immutable and system-generated — it is intentionally NOT
  // updatable. Any `code` sent in the body is rejected by the validation pipe
  // (forbidNonWhitelisted).

  @IsEnum(BranchStatus)
  @IsOptional()
  status?: BranchStatus;

  @IsDateString()
  @IsOptional()
  establishedDate?: string;

  // ── Location ──────────────────────────────────────────────────────────────
  @IsString()
  @IsOptional()
  @MaxLength(500)
  addressLine?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  city?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  state?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  pincode?: string;

  // ── Contact ───────────────────────────────────────────────────────────────
  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  managerName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  managerPhone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  labDirector?: string;

  // ── Operations ────────────────────────────────────────────────────────────
  @IsString()
  @IsOptional()
  @Matches(HH_MM, { message: 'openingTime must be a 24h HH:mm time' })
  openingTime?: string;

  @IsString()
  @IsOptional()
  @Matches(HH_MM, { message: 'closingTime must be a 24h HH:mm time' })
  closingTime?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  dailyCapacity?: number;

  @IsEnum(DayOfWeek, { each: true })
  @ArrayUnique()
  @IsOptional()
  operationalDays?: DayOfWeek[];

  // ── Compliance / misc ───────────────────────────────────────────────────────
  @IsString()
  @IsOptional()
  @MaxLength(50)
  gstNo?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  licenseNo?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  remarks?: string;
}
