import { MessagingChannel } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { FEATURE_TYPE_VALUES } from '../constants/feature-types';

/**
 * Query for `GET /templates/lookup` — a partial, dropdown-optimised listing.
 * Pagination (from `PaginationQueryDto`) plus optional channel/feature filters.
 * Tenant and branch scope come from the JWT (CLAUDE.md §4.7), never the query.
 */
export class LookupTemplateQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(MessagingChannel)
  preference?: MessagingChannel;

  @IsOptional()
  @IsString()
  @IsIn(FEATURE_TYPE_VALUES)
  feature?: string;
}
