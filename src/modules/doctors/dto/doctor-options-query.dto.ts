import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the lightweight `GET /doctors/options` endpoint (id + name
 * only), used by searchable, paginated selectors. Only CONSULTANT doctors are
 * returned (enforced in the service). All fields are optional:
 *
 * - `branchId` — include only doctors on this branch.
 * - `search` — case-insensitive match against the doctor `firstName`.
 * - `page` / `limit` (inherited) — **opt-in** offset pagination. When `page` is
 *   omitted the endpoint returns the full `{ id, name }[]` array; when `page` is
 *   supplied it returns a paginated `{ data, total, page, limit }` envelope.
 */
export class DoctorOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
