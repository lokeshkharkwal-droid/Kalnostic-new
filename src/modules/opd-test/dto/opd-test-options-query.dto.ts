import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the lightweight `GET /opd-tests/options` endpoint (id +
 * name only). All fields optional: `branchId` scopes to a branch; `search`
 * case-insensitively matches `testName`; `page`/`limit` opt into pagination.
 */
export class OpdTestOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
