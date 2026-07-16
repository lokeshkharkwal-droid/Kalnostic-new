import { IsOptional, IsUUID } from 'class-validator';

/**
 * Query params shared by every business-admin dashboard aggregate endpoint.
 * `branchId` omitted (the "All Branches" option) aggregates across the whole
 * tenant; a real id scopes to just that branch.
 */
export class BusinessAdminDashboardQueryDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
