import { IsOptional, IsUUID } from 'class-validator';

/**
 * Query for resolving which pricing lists an order should use, given the selected
 * referrals. Priority: referralPanel (B2B) → ptCategory → referredByDoctor →
 * internalReferral → externalReferral; falls back to the branch's default Walk-in
 * lists.
 */
export class ResolveListsQueryDto {
  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

  /** A selected PT (Patient) Category — priority slot 2, after the B2B panel. */
  @IsOptional()
  @IsUUID()
  ptCategoryId?: string;

  @IsOptional()
  @IsUUID()
  referredByDoctorId?: string;

  @IsOptional()
  @IsUUID()
  internalReferralId?: string;

  @IsOptional()
  @IsUUID()
  externalReferralId?: string;
}
