/**
 * One top-of-page stat card on the accession dashboard (Total Samples,
 * In-House, Internal Referral, External Referral, Outsourced).
 */
export interface AccessionStatCard {
  label: string;
  value: number;
  /** Signed percent change vs. yesterday, e.g. 12.5 or -3.2. `0` when
   * yesterday's count was 0 (no meaningful percentage to compute). */
  changePct: number;
}

/** One donut/pill slice, shared shape for every accession dashboard count breakdown. */
export interface AccessionDashboardSlice {
  label: string;
  value: number;
}

/** One bar in a Sent/Received referral-orders panel (one row per internal/external center). */
export interface ReferralOrderBar {
  center: string;
  count: number;
}
