import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import type { OrderDateMode } from '../dashboard.service';

/** The Registration dashboard's Billings "module" tab. */
export type BillingsModule =
  | 'all'
  | 'diagnostics'
  | 'opd'
  | 'radiology'
  | 'ipd'
  | 'pharmacy';

/**
 * Query params for the Registration dashboard's "Billings" summary endpoint.
 * `branchId` accepts a real branch id, the literal `"all"` (a Business
 * Admin's "All Branches" aggregate), or is omitted (see
 * `RegistrationOrdersQueryDto`'s doc comment — real validation happens in
 * the controller's `resolveBranchScope`). `dateMode`/`module` scope which
 * orders' payments are summed; both default in the service when omitted.
 * `createdBy` scopes to orders created by that one `Person` (from
 * `getRegistrationUsers`'s dropdown); omitted returns the branch's full total.
 */
export class RegistrationBillingsQueryDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsIn(['today', 'backdated', 'advanced-dated'])
  @IsOptional()
  dateMode?: OrderDateMode;

  @IsIn(['all', 'diagnostics', 'opd', 'radiology', 'ipd', 'pharmacy'])
  @IsOptional()
  module?: BillingsModule;

  @IsUUID()
  @IsOptional()
  createdBy?: string;
}
