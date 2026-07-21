import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the equipment listing endpoint
 * (`GET /siteadmin/equipment`). Extends the shared pagination DTO. `search`
 * matches `name` (case-insensitive). Validated by `class-validator` only.
 */
export class ListEquipmentDto extends PaginationQueryDto {
  /** Free-text match against `name` (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
