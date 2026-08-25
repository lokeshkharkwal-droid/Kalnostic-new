import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import type { BillingsModule } from './registration-billings-query.dto';

/**
 * Query params for the Registration dashboard's "Payment Status" summary
 * endpoint. `branchId` accepts a real branch id, `"all"`, or is omitted (see
 * `RegistrationOrdersQueryDto`'s doc comment). `module` scopes which orders'
 * payments are summed; defaults to `'all'` in the service when omitted. No
 * `dateMode` — this card is all-time (confirmed with the user), unlike
 * Orders/Billings. `createdBy` scopes to orders created by that one `Person`
 * (from `getRegistrationUsers`'s dropdown); omitted returns the branch's
 * full total. `referralPanelId` is the B2B view — mutually exclusive with
 * `createdBy` in the UI (selecting one resets the other), same convention as
 * Outstandings/Canceled/Refunds.
 */
export class RegistrationPaymentStatusQueryDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsIn(['all', 'diagnostics', 'opd', 'radiology', 'ipd', 'pharmacy'])
  @IsOptional()
  module?: BillingsModule;

  @IsUUID()
  @IsOptional()
  createdBy?: string;

  @IsUUID()
  @IsOptional()
  referralPanelId?: string;
}
