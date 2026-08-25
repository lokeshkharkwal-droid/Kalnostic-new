import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

/** The Refunds card's two mutually-exclusive views. */
export type RefundsView = 'user-wise' | 'b2b';

/**
 * Query params for the Registration dashboard's "Refunds" summary endpoint.
 * `branchId` accepts a real branch id, the literal `"all"` (a Business
 * Admin's "All Branches" aggregate), or is omitted (real validation happens
 * in the controller's `resolveBranchScope`). `view` selects between the
 * User-wise (by order creator) and B2B (by referral panel) Top-5 views;
 * defaults to `'user-wise'` in the controller when omitted — the
 * dashboard's default landing state. `createdBy`/`referralPanelId` are each
 * meaningful only for their own view: `createdBy` narrows `'user-wise'` to
 * just refunds on orders that user created (there's no reliable "who
 * processed this refund" actor — confirmed with the user); `referralPanelId`
 * narrows `'b2b'` to just that panel's own refunds. Both selections are
 * still capped at 5, matching the card's Top-5 framing in every state.
 */
export class RegistrationRefundsQueryDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsIn(['user-wise', 'b2b'])
  @IsOptional()
  view?: RefundsView;

  @IsUUID()
  @IsOptional()
  createdBy?: string;

  @IsUUID()
  @IsOptional()
  referralPanelId?: string;
}
