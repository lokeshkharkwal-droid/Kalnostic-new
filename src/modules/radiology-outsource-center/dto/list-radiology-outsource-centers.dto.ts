import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the radiology outsource-center listing endpoint
 * (`GET /radiology-outsource-centers`). Extends the shared pagination DTO.
 * `search` matches the center `name` or `code` (case-insensitive); `status`
 * filters by active state. Validated by `class-validator` only.
 */
export class ListRadiologyOutsourceCentersDto extends PaginationQueryDto {
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
