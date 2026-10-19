import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';

/**
 * Query DTO for the lightweight `GET /branch-radiology-panels/options` endpoint,
 * used by searchable, paginated selectors across the app (the Create-Order page,
 * finance report filters, accession, order console). The active branch is
 * resolved from the JWT profile (never the body), so there is no `branchId` here.
 *
 * - `search` — case-insensitive match against the branch radiology panel
 *   `panelName`.
 * - `page` / `limit` (inherited) — offset pagination. When `page` is omitted the
 *   endpoint returns the full option array; when supplied it returns a paginated
 *   `{ data, total, page, limit }` envelope.
 * - `preferredOnly` — when true AND `search` is empty, narrows results to
 *   `isPreference: true`. Opt-in and defaults to false so every existing caller
 *   keeps seeing the full catalogue unchanged.
 */
export class BranchRadiologyPanelOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Which pricing list to load options from. Omitted = the branch's Walk-in list. */
  @IsOptional()
  @IsUUID()
  listId?: string;

  /** Narrow the unsearched view to preference panels only (Create-Order picker). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  preferredOnly?: boolean;
}
