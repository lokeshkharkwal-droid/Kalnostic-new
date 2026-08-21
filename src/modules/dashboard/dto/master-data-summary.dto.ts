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

/** Active vs. inactive headcount for one staff role. */
export interface StaffAvailabilitySlice {
  role: string;
  active: number;
  inactive: number;
}

/** Male/female/total headcount for one patient bucket (New/Previous/Total). */
export interface PatientBucket {
  male: number;
  female: number;
  total: number;
}

/** The Registration dashboard's Patients card: New/Previous/Total buckets. */
export interface PatientsSummary {
  newPatients: PatientBucket;
  previousPatients: PatientBucket;
  totalPatients: PatientBucket;
}

/** One revenue-line row in the Registration dashboard's Billings breakdown. */
export interface BillingRow {
  label: string;
  amount: number;
  percentLabel: string;
}

/** The Registration dashboard's Billings card. */
export interface BillingsSummary {
  totalBillings: number;
  rows: BillingRow[];
}

/** One day of the branch-admin/business-admin dashboards' weekly Schedule Plan table. */
export interface ScheduleDayRow {
  day: string;
  status: 'Open' | 'Closed';
  morningShift: string | null;
  afternoonShift: string | null;
  eveningShift: string | null;
  nightShift: string | null;
}

/** One selectable user in the Registration dashboard's User Filter dropdowns. */
export interface RegistrationUserOption {
  /** `Person.id` — the value sent back as `createdBy` when this user is selected. */
  id: string;
  /** Display name (first + middle + last, whichever parts exist). */
  name: string;
}
