import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';

/** A single module-grouped permission grant for a (branch + role). */
export class BranchRolePermissionItemDto {
  @IsString()
  moduleKey: string;

  @IsString()
  permissionKey: string;

  /** true = granted, false = denied (overrides the static role baseline). */
  @IsBoolean()
  allowed: boolean;
}

/**
 * Replace the (branch + role) permission overrides — the branch-level tier that
 * sits between the static role baseline and per-user overrides. The client sends
 * the full desired set for the branch-role (supports Select-All / Deselect-All
 * per module). The branch and role come from the route, not the body. Only
 * modules enabled for the branch are accepted.
 */
export class UpdateBranchRolePermissionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchRolePermissionItemDto)
  items: BranchRolePermissionItemDto[];
}
