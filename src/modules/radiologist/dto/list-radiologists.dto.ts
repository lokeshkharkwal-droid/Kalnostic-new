import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the radiologist listing endpoint. Extends the shared
 * pagination DTO. `search` matches `name`/`email`/`mobile` (case-insensitive);
 * `departmentId` filters by department. All filters optional.
 */
export class ListRadiologistsDto extends PaginationQueryDto {
  /** Free-text match against `name` OR `email` OR `mobile` (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Department filter. */
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
