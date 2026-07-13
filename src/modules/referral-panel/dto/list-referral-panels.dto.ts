import { ReferralClientType } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the referral-panel listing endpoint
 * (`GET /referral-panels`). Extends the shared pagination DTO. `search` matches
 * the panel `name` or the user-supplied `panelCode` (case-insensitive);
 * `clientType` filters by billing relationship; `status` filters by active
 * state; `branchId` restricts to panels scoped to that branch. Validated by
 * `class-validator` only.
 */
export class ListReferralPanelsDto extends PaginationQueryDto {
  /** Case-insensitive match against panel name or panel code. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Filter by billing relationship (CASH / PREPAID / POSTPAID). */
  @IsOptional()
  @IsEnum(ReferralClientType)
  clientType?: ReferralClientType;

  /** Filter by active state (mapped to `isActive` in the service). */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  /** Restrict to referral panels scoped to this branch. */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
