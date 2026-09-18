import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';
import { OverallResultTemplateStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Coerce a repeated or comma-separated query param into a string array.
 * Accepts `groupNames=a,b,c` (one param) or `groupNames=a&groupNames=b`
 * (repeated) and normalises both to `['a','b','c']`, dropping blanks. Returns
 * `undefined` when the param is absent so the filter stays optional. Same
 * helper as `template`'s `list-template-query.dto.ts`'s `clonedFromId`.
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
 * Query parameters for the Overall Result template listing endpoint
 * (`GET /overall-result-templates`). Extends the shared pagination DTO with a
 * case-insensitive `search` on `name`, an optional exact `groupName` filter,
 * an optional `groupNames` (plural, case-insensitive `IN` match — for the
 * Technician Dashboard's "any group this test's parameters are tagged into"
 * picker) filter, and an optional `status` filter. Validated by
 * `class-validator` only.
 */
export class ListOverallResultTemplateDto extends PaginationQueryDto {
  /** Case-insensitive match against the certificate/template name. */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  search?: string;

  /** Case-insensitive exact match against the group name. */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  groupName?: string;

  /**
   * Case-insensitive `IN` match against the group name — templates whose
   * `groupName` is any of these. Mutually additive with `groupName` (both may
   * be sent; a template matches if it satisfies either).
   */
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  groupNames?: string[];

  /** Filter by lifecycle status. */
  @IsEnum(OverallResultTemplateStatus)
  @IsOptional()
  status?: OverallResultTemplateStatus;
}
