import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * Query params shared by every accession dashboard aggregate endpoint.
 * `branchId`'s contract now mirrors the Registration dashboard's:
 * - Normal (branch-scoped) profile: `branchId` is ALWAYS resolved to their
 *   own active branch server-side (`resolveBranchScope`) — any explicit
 *   value, matching or not, is irrelevant; they can never see another
 *   branch's or the tenant's combined data. This closes a real gap: before
 *   this change, `branchId` was client-supplied with no ownership check at
 *   all, so any authenticated Accession user could pass another branch's id
 *   (or omit it for a tenant-wide aggregate) and the server complied.
 * - `business_admin` profile: omitted or `"all"` aggregates across every
 *   branch where they have Accession access (never every tenant branch); an
 *   explicit id is validated against that same accessible set.
 *
 * `branchId` is a plain string (not `@IsUUID()`) since it must also accept
 * the literal `"all"` — real ownership/module-access validation happens in
 * `resolveBranchScope`, not here.
 *
 * `dateFrom`/`dateTo` are the header's date-range filter — but unlike
 * business-admin/branch-admin, only 4 of this dashboard's cards actually use
 * them: Internal/External Referral Orders, Outsource Orders, and the
 * "Rejected Samples" line in Critical Alerts (all `SampleTransfer`-based
 * event counts). Every other card (Stats Summary, Order Status Overview,
 * TAT Compliance, TAT Breached/On Hold/Repeat in Critical Alerts) is a live
 * current-state snapshot with no historical meaning, so those ignore this
 * filter entirely — confirmed with the user rather than reinterpreting
 * "currently on Hold" as "created in this range and currently on Hold",
 * which would silently change what the number means.
 */
export class AccessionDashboardQueryDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;
}
