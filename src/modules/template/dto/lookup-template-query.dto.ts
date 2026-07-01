import { TemplateType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /templates/lookup` — a partial, dropdown-optimised listing.
 * Pagination (from `PaginationQueryDto`) plus an optional `type` tab filter.
 * Tenant and branch scope come from the JWT (CLAUDE.md §4.7), never the query.
 */
export class LookupTemplateQueryDto extends PaginationQueryDto {
  /** Restrict the lookup to one template type. */
  @IsOptional()
  @IsEnum(TemplateType)
  type?: TemplateType;
}
