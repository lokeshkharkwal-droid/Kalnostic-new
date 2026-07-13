import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the lightweight `GET /branch-lab-panels/options` endpoint (id +
 * name only), used by searchable, paginated selectors on the Create-Order page.
 * The active branch is resolved from the JWT profile (never the body), so there
 * is no `branchId` here.
 *
 * - `search` — case-insensitive match against the branch lab panel `panelName`.
 * - `page` / `limit` (inherited) — offset pagination. When `page` is omitted the
 *   endpoint returns the full `{ id, name }[]` array; when supplied it returns a
 *   paginated `{ data, total, page, limit }` envelope.
 */
export class BranchLabPanelOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
