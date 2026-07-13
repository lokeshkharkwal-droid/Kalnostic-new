import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the lightweight `GET /referral-panels/options` endpoint (id +
 * name only), used by searchable, paginated selectors. All fields are optional:
 *
 * - `search` — case-insensitive match against the referral panel `name`.
 * - `page` / `limit` (inherited) — **opt-in** offset pagination. When `page` is
 *   omitted the endpoint returns the full `{ id, name }[]` array; when `page` is
 *   supplied it returns a paginated `{ data, total, page, limit }` envelope.
 */
export class ReferralPanelOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
