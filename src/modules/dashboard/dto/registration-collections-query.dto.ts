import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import type { OrderDateMode } from '../dashboard.service';

/**
 * Query params for the Registration dashboard's "Collections" summary
 * endpoint. `branchId` accepts a real branch id, the literal `"all"` (a
 * Business Admin's "All Branches" aggregate), or is omitted (see
 * `RegistrationOrdersQueryDto`'s doc comment — real validation happens in
 * the controller's `resolveBranchScope`). `dateMode` scopes which payments
 * are summed by `PaymentDetails.paymentDate` (when the payment happened,
 * not the parent order's `orderDate`; falls back to `createdAt` for older
 * rows with a null `paymentDate`); defaults to `'today'` in the service
 * when omitted. `createdBy` scopes to orders created by that one `Person`
 * (from `getRegistrationUsers`'s dropdown); omitted returns the branch's
 * full total.
 */
export class RegistrationCollectionsQueryDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsIn(['today', 'backdated', 'advanced-dated'])
  @IsOptional()
  dateMode?: OrderDateMode;

  @IsUUID()
  @IsOptional()
  createdBy?: string;
}
