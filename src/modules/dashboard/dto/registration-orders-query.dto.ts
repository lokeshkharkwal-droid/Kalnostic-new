import { IsIn, IsOptional, IsString } from 'class-validator';
import type { OrderDateMode } from '../dashboard.service';

/**
 * Query params for the Registration dashboard's "Orders" summary endpoint.
 * `branchId` accepts a real branch id, the literal `"all"` (a Business
 * Admin's "All Branches" aggregate), or is omitted entirely (normal profile
 * → own branch; business_admin → same as `"all"`) — real ownership/
 * module-access validation happens in the controller's `resolveBranchScope`,
 * not here, so this is deliberately just a shape check. `dateMode` selects
 * which orders count by `orderDate` relative to today; defaults to `'today'`
 * in the service when omitted.
 */
export class RegistrationOrdersQueryDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsIn(['today', 'backdated', 'advanced-dated'])
  @IsOptional()
  dateMode?: OrderDateMode;
}
