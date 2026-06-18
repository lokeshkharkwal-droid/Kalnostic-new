import { InternalReferralStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query params for the internal-referrals list endpoint. Extends the shared offset
 * pagination DTO with a free-text `search` by employee name (tokenised across
 * first/last/full name, with the mobile number as a fallback) and a `status` filter.
 */
export class ListInternalReferralsDto extends PaginationQueryDto {
  /**
   * Search by employee name. Split on whitespace; each token must match some name
   * part (firstName/lastName/fullName), with mobileNumber as a fallback — so
   * "Anita Sharma" matches first+last and a single token matches any part.
   */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;

  @IsEnum(InternalReferralStatus)
  @IsOptional()
  status?: InternalReferralStatus;
}
