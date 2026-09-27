import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the lightweight `GET /opd-panels/options` endpoint (id +
 * name only). `branchId` scopes to a branch; `search` matches `panelName`;
 * `page`/`limit` opt into pagination.
 */
export class OpdPanelOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
