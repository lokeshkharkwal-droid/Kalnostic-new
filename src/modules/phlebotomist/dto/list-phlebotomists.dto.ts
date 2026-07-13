import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the phlebotomist listing endpoint. Extends the shared
 * pagination DTO. `search` matches `name`/`email`/`mobile` (case-insensitive).
 */
export class ListPhlebotomistsDto extends PaginationQueryDto {
  /** Free-text match against `name` OR `email` OR `mobile` (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
