import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SwitchProfileDto {
  /** Target branch id; omit for tenant-level profiles (e.g. business_admin). */
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  @IsNotEmpty()
  profileKey: string;
}
