import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** Assign a profile to a person at a branch (or tenant-level when branchId omitted). */
export class AssignProfileDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  profileKey: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

/** Set which assignment is the default landing profile after login. */
export class SetDefaultProfileDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  profileKey: string;
}

/** Revoke a profile assignment. */
export class RevokeProfileDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  profileKey: string;
}
