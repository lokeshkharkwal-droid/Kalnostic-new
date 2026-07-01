import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the test-group listing endpoint
 * (`GET /siteadmin/test-groups`). Extends the shared pagination DTO. `search`
 * matches `groupName` (case-insensitive). Validated by `class-validator` only.
 */
export class ListTestGroupsDto extends PaginationQueryDto {
  /** Free-text match against `groupName` (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
