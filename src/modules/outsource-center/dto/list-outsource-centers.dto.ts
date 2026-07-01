import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { OutsourceCenterListView } from '../entities/outsource-center.entity';

/**
 * Query parameters for the outsource-center listing endpoint
 * (`GET /outsource-centers`). Extends the shared pagination DTO. `view` selects
 * the response shape: `DEFAULT` (or omitted) returns the paginated centers;
 * `CONTACTS` returns a flat, paginated list of every contact across the tenant's
 * centers. `search` matches the center `name` or `code` (case-insensitive);
 * `status` filters by active state. Validated by `class-validator` only.
 */
export class ListOutsourceCentersDto extends PaginationQueryDto {
  /** Response shape; defaults to DEFAULT in the service when omitted. */
  @IsOptional()
  @IsEnum(OutsourceCenterListView)
  view?: OutsourceCenterListView;

  /** Case-insensitive match against the center name or code. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Filter by active state (mapped to `isActive` in the service). */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
