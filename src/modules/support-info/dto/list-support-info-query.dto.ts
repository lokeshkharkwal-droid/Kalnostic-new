import { SupportStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /siteadmin/support-info` — pagination (from
 * `PaginationQueryDto`) plus an optional case-insensitive `search` (matched
 * against `metaType` or `code`) and an active/inactive `status` filter.
 */
export class ListSupportInfoQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against `metaType` or `code`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Filter by active (`ACTIVE`) or inactive (`INACTIVE`) records. */
  @IsOptional()
  @IsEnum(SupportStatus)
  status?: SupportStatus;
}
