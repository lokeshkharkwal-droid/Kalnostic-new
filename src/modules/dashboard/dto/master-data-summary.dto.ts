/** One donut slice: a department name and its active-lab-test count. */
export interface MasterDataSummarySlice {
  label: string;
  value: number;
}

/** One donut slice, shared shape for every dashboard count breakdown. */
export interface DashboardSlice {
  label: string;
  value: number;
}
