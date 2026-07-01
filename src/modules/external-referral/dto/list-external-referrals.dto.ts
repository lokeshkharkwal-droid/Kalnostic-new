import { ExternalReferralStatus } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query params for the external-referrals list endpoint. Extends the shared offset
 * pagination DTO with a free-text `search` by referral name (tokenised; the
 * organisation name, mobile number, and referral code are matched as fallbacks), a
 * `status` filter, and a `branchId` filter (referrals belonging to that branch).
 */
export class ListExternalReferralsDto extends PaginationQueryDto {
  /**
   * Search by referral name. Split on whitespace; each token must match the name
   * (with organisationName / mobileNumber / referralCode as fallbacks) — so a single
   * token matches any of those parts.
   */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;

  @IsEnum(ExternalReferralStatus)
  @IsOptional()
  status?: ExternalReferralStatus;

  /** Restrict to external referrals belonging to this branch. */
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
