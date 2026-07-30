import {
  ApplicableBranchType,
  MessageType,
  MessagingChannel,
  MessagingLevel,
} from '@prisma/client';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsArray,
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
 * Coerce a repeated or comma-separated query param into a string array.
 *
 * Accepts `clonedFromId=a,b,c` (one param) or `clonedFromId=a&clonedFromId=b`
 * (repeated) and normalises both to `['a','b','c']`, dropping blanks. Returns
 * `undefined` when the param is absent so the filter stays optional.
 */
const toStringArray = ({
  obj,
  key,
}: TransformFnParams): string[] | undefined => {
  const raw = (obj as Record<string, string | string[] | undefined>)[key];
  if (raw === undefined || raw === null) return undefined;
  const parts = Array.isArray(raw) ? raw : raw.split(',');
  return parts.map((s) => s.trim()).filter(Boolean);
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

  /**
   * Exclude a single message type (e.g. `MARKETING`), keeping every other type
   * **and** rows with no message type. Lets the channel tabs (SMS/Email/
   * WhatsApp) list non-marketing templates while the Bulk tab owns the
   * MARKETING ones — mutually exclusive with `messageType` per request.
   */
  @IsOptional()
  @IsEnum(MessageType)
  messageTypeNot?: MessageType;

  /**
   * Restrict to templates cloned from these SITE_ADMIN global template ids.
   * Used by the "enable" screen to resolve, in one bounded call, which of the
   * globals on the current page the tenant has already imported.
   */
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  clonedFromId?: string[];

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
