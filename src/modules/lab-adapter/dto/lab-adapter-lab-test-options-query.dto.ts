import { Transform, TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Coerce a repeated or comma-separated query param into a string array
 * (`branchIds=a,b` or `branchIds=a&branchIds=b` → `['a','b']`), dropping blanks.
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
 * Query DTO for `GET /lab-adapters/lab-test-options` — the Lab Adapter form's
 * manual Lab Tests picker.
 *
 * - `branchIds` — the branches selected in the adapter form (required, ≥ 1).
 *   Client-supplied because an adapter is tenant-level and a Business Admin has
 *   no active branch; every id is verified against the JWT tenant in the service.
 * - `search` — case-insensitive match against the test name.
 * - `page` / `limit` (inherited) — omit `page` for the full array.
 */
export class LabAdapterLabTestOptionsQueryDto extends PaginationQueryDto {
  @Transform(toStringArray)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  branchIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
