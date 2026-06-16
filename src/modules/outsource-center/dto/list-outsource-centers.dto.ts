import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { OutsourceCenterListView } from '../entities/outsource-center.entity';

/**
 * Query parameters for the outsource-center listing endpoint
 * (`GET /outsource-centers`). Extends the shared pagination DTO. `view` selects
 * the response shape: `DEFAULT` (or omitted) returns the paginated centers;
 * `CONTACTS` returns a flat, paginated list of every contact across the tenant's
 * centers. Validated by `class-validator` only.
 */
export class ListOutsourceCentersDto extends PaginationQueryDto {
  /** Response shape; defaults to DEFAULT in the service when omitted. */
  @IsOptional()
  @IsEnum(OutsourceCenterListView)
  view?: OutsourceCenterListView;
}
