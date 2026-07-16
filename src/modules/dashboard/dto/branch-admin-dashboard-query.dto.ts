import { IsOptional, IsUUID } from 'class-validator';

/**
 * Query params for every branch-admin dashboard aggregate endpoint.
 * `branchId` is optional here only because branch-admin defaults to their own
 * active branch when omitted — supplying a different branch is rejected (see
 * `DashboardController.resolveBranch`), so this never widens branch-admin's
 * effective scope beyond their own branch.
 */
export class BranchAdminDashboardQueryDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
