import { IsOptional, IsUUID } from 'class-validator';

/**
 * Query for resolving which pricing lists an order should use, given the selected
 * referrals. Priority: referralPanel → referredByDoctor → internalReferral →
 * externalReferral; falls back to the branch's default Walk-in lists.
 */
export class ResolveListsQueryDto {
  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

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
