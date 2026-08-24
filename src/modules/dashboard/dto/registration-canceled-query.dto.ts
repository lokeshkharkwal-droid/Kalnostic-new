import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

/** The Cancellation card's two mutually-exclusive views. */
export type CanceledView = 'user-wise' | 'b2b';

/**
 * Query params for the Registration dashboard's "Cancellation" summary
 * endpoint. `branchId` accepts a real branch id, the literal `"all"` (a
 * Business Admin's "All Branches" aggregate), or is omitted (real validation
 * happens in the controller's `resolveBranchScope`). `view` selects between
 * the User-wise (by canceller) and B2B (by referral panel) Top-5 views;
 * defaults to `'user-wise'` in the controller when omitted — the
 * dashboard's default landing state. `cancelledBy`/`referralPanelId` are
 * each meaningful only for their own view: `cancelledBy` (a `Person.id` from
 * `getCancellationUsers`) narrows `'user-wise'` to just that canceller's own
 * cancellations (no top-5 cap); `referralPanelId` narrows `'b2b'` to just
 * that panel's own cancellations (no top-5 cap). Omitted in either view
 * means the Top-5 spans the whole population that view covers.
 */
export class RegistrationCanceledQueryDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsIn(['user-wise', 'b2b'])
  @IsOptional()
  view?: CanceledView;

  @IsUUID()
  @IsOptional()
  cancelledBy?: string;

  @IsUUID()
  @IsOptional()
  referralPanelId?: string;
}
