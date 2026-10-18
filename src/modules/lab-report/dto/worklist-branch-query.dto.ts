import { IsOptional, Matches } from 'class-validator';

/** A branch id (UUID) or the literal `all`. */
export const BRANCH_OR_ALL_PATTERN =
  /^(all|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const BRANCH_OR_ALL_MESSAGE =
  'branchId must be a branch id (UUID) or "all"';

/**
 * Branch selection shared by the Technician worklists: omitted = the caller's own
 * branch (the default); a branch id = that branch only; `all` = every branch the
 * caller is authorised for through branch access + Technician-module access
 * (never the whole tenant). Validated against that authorised set server-side.
 */
export class WorklistBranchQueryDto {
  @IsOptional()
  @Matches(BRANCH_OR_ALL_PATTERN, { message: BRANCH_OR_ALL_MESSAGE })
  branchId?: string;
}
