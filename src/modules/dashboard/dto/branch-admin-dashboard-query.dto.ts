import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * Query params for every branch-admin dashboard aggregate endpoint — also
 * reused by several Registration dashboard endpoints (`resolveBranchScope`),
 * where `branchId` additionally accepts the literal `"all"` (a Business
 * Admin's "All Branches" aggregate). `branchId` is a plain string (not
 * `@IsUUID()`) since real ownership/module-access validation happens in
 * each controller's own branch-resolution method, not here — branch-admin
 * defaults to their own active branch when omitted, and supplying a
 * different branch is rejected there, so this never widens branch-admin's
 * effective scope beyond their own branch. `dateFrom`/`dateTo` omitted (the
 * header's default, no range selected) returns each card's normal
 * current-state totals; when both are set, every count is scoped to rows
 * `createdAt`-ed within that range instead (confirmed with the user, mirrors
 * business-admin's header date-range filter).
 */
export class BranchAdminDashboardQueryDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;
}
