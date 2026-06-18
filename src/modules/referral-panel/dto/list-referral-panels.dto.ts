import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the referral-panel listing endpoint
 * (`GET /referral-panels`). Extends the shared pagination DTO. `search` matches
 * the panel `name` or the user-supplied `panelCode` (case-insensitive). Validated
 * by `class-validator` only.
 */
export class ListReferralPanelsDto extends PaginationQueryDto {
  /** Case-insensitive match against panel name or panel code. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
