import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the lightweight `GET /lab-adapters/options` endpoint
 * (`{ id, name }[]`), used by the Reference Range Master Analyzer selector
 * (Adapter-wise reference ranges).
 *
 * - `branchId` — narrows to adapters assigned to this branch (via
 *   `LabAdapterBranch`). Optional: Business Admin has no active branch, so the
 *   caller supplies one from a branch picker; Branch Admin can pass its own
 *   JWT-derived active branch instead.
 * - `search` — case-insensitive match against the adapter `name`.
 * - `page` / `limit` (inherited) — omit `page` for the full array; supply it
 *   for a paginated `{ data, total, page, limit }` envelope (the frontend's
 *   shared `optionFetcher` always supplies both).
 */
export class LabAdapterOptionsQueryDto extends PaginationQueryDto {
  @IsUUID('4')
  @IsOptional()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
