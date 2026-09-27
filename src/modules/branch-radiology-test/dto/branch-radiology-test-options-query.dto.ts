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
 * Query DTO for the lightweight `GET /branch-radiology-tests/options` endpoint. The
 * active branch is resolved from the JWT profile (never the body).
 *
 * - `search` — case-insensitive match against the branch radiology test `testName`.
 * - `page`/`limit` (inherited) — offset pagination (full array when `page` omitted).
 * - `listId` — which pricing list to load options from (omitted = Walk-in).
 * - `preferredOnly` — when true AND `search` is empty, narrows to `isPreferenceTest`.
 */
export class BranchRadiologyTestOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsUUID()
  listId?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  preferredOnly?: boolean;
}
