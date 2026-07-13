import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the lightweight `GET /internal-referrals/options` endpoint (id +
 * name only), used by searchable, paginated selectors. All fields are optional:
 *
 * - `search` — case-insensitive match against the internal referral `firstName`.
 * - `page` / `limit` (inherited) — **opt-in** offset pagination. When `page` is
 *   omitted the endpoint returns the full `{ id, name }[]` array; when `page` is
 *   supplied it returns a paginated `{ data, total, page, limit }` envelope.
 */
export class InternalReferralOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
