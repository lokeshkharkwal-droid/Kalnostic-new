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
 * Query DTO for the lightweight `GET /branch-radiology-tests/options` endpoint,
 * used by the Create-Order radiology-test picker. The active branch is resolved
 * from the JWT profile (never the body), so there is no `branchId` here.
 *
 * - `search` — case-insensitive match against the branch radiology test `testName`.
 * - `page` / `limit` (inherited) — offset pagination. When `page` is omitted the
 *   endpoint returns the full option array; when supplied it returns a paginated
 *   envelope.
 * - `preferredOnly` — when true AND `search` is empty, narrows results to
 *   `isPreferenceTest: true`. Opt-in; defaults to false.
 */
export class BranchRadiologyTestOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Which pricing list to load options from. Omitted = the branch's Walk-in list. */
  @IsOptional()
  @IsUUID()
  listId?: string;

  /** Narrow the unsearched view to preference tests only (Create-Order picker). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  preferredOnly?: boolean;
}
