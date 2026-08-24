import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * Query params shared by every business-admin dashboard aggregate endpoint.
 * `branchId` omitted (the "All Branches" option) aggregates across the whole
 * tenant; a real id scopes to just that branch. `dateFrom`/`dateTo` omitted
 * (the header's default, no range selected) returns each card's normal
 * current-state totals; when both are set, every count is scoped to rows
 * `createdAt`-ed within that range instead (confirmed with the user).
 */
export class BusinessAdminDashboardQueryDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;
}
