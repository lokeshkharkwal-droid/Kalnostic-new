import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the lab-panel listing endpoint
 * (`GET /master-data/:masterDataId/lab-panels/listing`). Extends the shared
 * pagination DTO. `search` matches `panelName` OR `panelCode` (case-insensitive);
 * `categoryId`/`departmentId` filter by parent category/department; `status`
 * maps to the `isActive` flag. All filters optional, validated by
 * `class-validator` only.
 */
export class ListLabPanelsDto extends PaginationQueryDto {
  /** Free-text match against `panelName` OR `panelCode` (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Parent category filter. */
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Parent department filter. */
  @IsOptional()
  @IsString()
  departmentId?: string;

  /** Active/inactive filter; mapped to `isActive` in the service. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
