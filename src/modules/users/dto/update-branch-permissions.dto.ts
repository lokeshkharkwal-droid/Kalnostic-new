import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';

/** A single module-grouped permission grant for a (user + branch). */
export class BranchPermissionItemDto {
  @IsString()
  moduleKey: string;

  @IsString()
  permissionKey: string;

  /** true = granted, false = denied (overrides the role baseline). */
  @IsBoolean()
  allowed: boolean;
}

/**
 * Replace the (user + branch) permission grants. The client sends the full set
 * for the branch (supports Select-All / Deselect-All per module). Only modules
 * enabled for the branch are accepted.
 */
export class UpdateBranchPermissionsDto {
  @IsString()
  branchId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchPermissionItemDto)
  items: BranchPermissionItemDto[];
}
