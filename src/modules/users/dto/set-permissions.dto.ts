import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/** A single permission override entry. `inherit` means "no override" (row dropped). */
export class PermissionOverrideItem {
  @IsString()
  code: string;

  @IsIn(['allow', 'deny', 'inherit'])
  override: 'allow' | 'deny' | 'inherit';
}

/** Bulk-set the override state for a profile assignment. */
export class SetPermissionsDto {
  /** Branch for branch-level profiles; omit for tenant-level. */
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  profileKey: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideItem)
  overrides: PermissionOverrideItem[];
}
