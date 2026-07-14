import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the lightweight `GET /external-referrals/options` endpoint (id +
 * name only), used by searchable, paginated selectors. All fields are optional:
 *
 * - `search` — case-insensitive match against the external referral `name`.
 * - `branchId` — restrict to a single branch (strict; records with no branch
 *   are excluded). The active branch is supplied by the caller.
 * - `page` / `limit` (inherited) — **opt-in** offset pagination. When `page` is
 *   omitted the endpoint returns the full `{ id, name }[]` array; when `page` is
 *   supplied it returns a paginated `{ data, total, page, limit }` envelope.
 */
export class ExternalReferralOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}
