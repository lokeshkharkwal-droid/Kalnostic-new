import { BranchType } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SYSTEM_MODULE_KEYS } from '../../permissions/constants/system-modules.constant';

/**
 * Query DTO for the lightweight `GET /branches/options` endpoint (id + name
 * only). All fields are optional:
 *
 * - `branchType` — include only branches of this type.
 * - `excludeBranchType` — exclude branches of this type (e.g.
 *   `excludeBranchType=COLLECTION_CENTER` to list valid sample-receiving
 *   branches, since a Collection Center cannot receive from another).
 * - `search` — case-insensitive match against branch `name` OR `code`.
 * - `moduleKey` — include only branches where this module is enabled
 *   (`BranchModule.isEnabled`). Used by the Registration/Accession dashboards'
 *   Business Admin branch selector, so the dropdown only ever lists branches
 *   where that module is actually turned on — never every tenant branch.
 * - `page` / `limit` (inherited) — **opt-in** offset pagination. When `page` is
 *   omitted the endpoint returns the full `{ id, name }[]` array (legacy
 *   behaviour for callers that need every option); when `page` is supplied it
 *   returns a paginated `{ data, total, page, limit }` envelope for the
 *   searchable, "Load More" selector.
 *
 * When both type filters are supplied, `branchType` (the include filter) takes
 * precedence.
 */
export class BranchOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(BranchType)
  branchType?: BranchType;

  @IsOptional()
  @IsEnum(BranchType)
  excludeBranchType?: BranchType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(SYSTEM_MODULE_KEYS)
  moduleKey?: string;
}
