import { TemplateType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /templates` — pagination (from `PaginationQueryDto`) plus the
 * tab filter (`type`), an optional case-insensitive name `search`, and an
 * `isActive` status filter. Scope (tenant-level vs branch-level) is derived from
 * the JWT in the controller, not from the query.
 */
export class ListTemplateQueryDto extends PaginationQueryDto {
  /** Tab filter — restrict to one template type. */
  @IsOptional()
  @IsEnum(TemplateType)
  type?: TemplateType;

  /** Case-insensitive match against `name`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Status filter (query params arrive as strings; coerce to a boolean). */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  isActive?: boolean;
}
