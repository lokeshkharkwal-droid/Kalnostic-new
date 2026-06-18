import { ReferralDoctorStatus } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query params for the referral-doctors list endpoint. Extends the shared offset
 * pagination DTO with a free-text `search` by doctor name (tokenised across
 * first/middle/last name, mobile number as a fallback), a `departmentId` filter, a
 * `categoryId` (Specialty) filter, and a `status` filter.
 */
export class ListReferralDoctorsDto extends PaginationQueryDto {
  /**
   * Search by doctor name. Split on whitespace; each token must match some name
   * part (firstName/middleName/lastName), with mobileNumber as a fallback — so
   * "Anita Sharma" matches first+last and a single token matches any part.
   */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsEnum(ReferralDoctorStatus)
  @IsOptional()
  status?: ReferralDoctorStatus;
}
