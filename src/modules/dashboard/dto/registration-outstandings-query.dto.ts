import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

/** The Outstandings card's two mutually-exclusive views. */
export type OutstandingsView = 'user-wise' | 'b2b';

/**
 * Query params for the Registration dashboard's "Outstandings" summary
 * endpoint. `branchId` accepts a real branch id, the literal `"all"` (a
 * Business Admin's "All Branches" aggregate), or is omitted (see
 * `RegistrationOrdersQueryDto`'s doc comment — real validation happens in
 * the controller's `resolveBranchScope`). `view` selects between the B2B
 * (referral-panel-grouped) breakdown and the User-wise view; defaults to
 * `'user-wise'` in the controller when omitted — that's the dashboard's
 * default landing state ("All Users" selected, B2B cleared). `createdBy`
 * applies to both views: for `'user-wise'`, omitted shows the Top 5
 * individual dues across every user, a specific user shows ALL of that
 * user's own outstanding orders; for `'b2b'`, it narrows the panel totals
 * to just that user's orders. `referralPanelId` only applies to `'b2b'` —
 * narrows to that one panel's own total; omitted returns every panel's
 * own slice (unmapped orders folded into "Others").
 */
export class RegistrationOutstandingsQueryDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsIn(['user-wise', 'b2b'])
  @IsOptional()
  view?: OutstandingsView;

  @IsUUID()
  @IsOptional()
  createdBy?: string;

  @IsUUID()
  @IsOptional()
  referralPanelId?: string;
}
