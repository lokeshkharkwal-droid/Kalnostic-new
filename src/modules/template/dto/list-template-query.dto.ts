import {
  ApplicableBranchType,
  MessageType,
  MessagingChannel,
  MessagingLevel,
} from '@prisma/client';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { FEATURE_TYPE_VALUES } from '../constants/feature-types';

/**
 * Coerce a query-string boolean (`'true'`/`'false'`) into a real boolean.
 *
 * Reads the raw value from the source object (`obj[key]`) rather than the
 * incoming `value`: the global `ValidationPipe` runs with
 * `enableImplicitConversion: true`, which otherwise coerces the string
 * `'false'` to boolean `true` (non-empty-string truthiness) before this
 * transform sees it — silently breaking `isActive=false`-style filters.
 */
const toBool = ({ obj, key }: TransformFnParams): boolean | undefined => {
  const raw = (obj as Record<string, unknown>)[key];
  return raw === undefined ? undefined : raw === 'true' || raw === true;
};

/**
 * Query for `GET /templates` — pagination (from `PaginationQueryDto`) plus
 * filters on channel, feature, message type, level, applicable branch type, a
 * case-insensitive `displayTitle` search, and the three boolean flags. Scope
 * (tenant-level vs branch-level) is derived from the JWT in the controller, not
 * from the query.
 */
export class ListTemplateQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(MessagingChannel)
  preference?: MessagingChannel;

  @IsOptional()
  @IsString()
  @IsIn(FEATURE_TYPE_VALUES)
  feature?: string;

  @IsOptional()
  @IsEnum(MessageType)
  messageType?: MessageType;

  @IsOptional()
  @IsEnum(MessagingLevel)
  level?: MessagingLevel;

  @IsOptional()
  @IsEnum(ApplicableBranchType)
  applicableBranchType?: ApplicableBranchType;

  /** Case-insensitive match against `displayTitle`. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  search?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isDefault?: boolean;
}
