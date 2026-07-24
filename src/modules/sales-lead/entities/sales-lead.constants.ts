import { LeadStatus, MeetingOutcome } from '@prisma/client';

/**
 * Sales option lists + lifecycle maps. The enum-backed lists are derived from
 * `@prisma/client`; the open-ended (tenant-flavoured) lists mirror the reference
 * FE `salesData.ts` and are surfaced via `GET /sales/options` so the FE dropdowns
 * stay identical. These live in `entities/` as module reference data.
 */

/** Open-ended lead categories (validated strings, not a DB enum). */
export const LEAD_CATEGORIES = [
  'Diagnostics Tie-up',
  'Hospital Tie-up',
  'Clinic Tie-up',
  'Doctor Referral',
  'Corporate Health Checkup',
  'Insurance / TPA Tie-up',
  'Pharmacy Tie-up',
  'Home Collection Partnership',
  'Collection Center Franchise',
  'B2B Sample Pickup',
  'Lab Outsourcing',
  'Radiology Referral',
  'Cardiology Referral',
  'Wellness Package Sales',
  'Annual Health Checkup Contract',
  'Occupational Health Contract',
  'Medical Camp',
  'School / College Health Program',
  'Industrial Health Program',
  'Software / LIMS Sale',
  'Equipment Sale',
  'AMC / CMC Service',
  'Consumables / Reagent Sale',
  'Clinical Trial Support',
  'Pharma Company Tie-up',
  'Government Tender / Contract',
  'NGO / CSR Health Program',
  'Other',
];

/** Open-ended organization types. */
export const ORGANIZATION_TYPES = [
  'Hospital',
  'Clinic',
  'Diagnostic Center',
  'Pathology Lab',
  'Radiology Center',
  'Pharmacy',
  'Corporate Company',
  'Industry / Factory',
  'School / College',
  'Medical College',
  'Nursing Home',
  'Insurance Company',
  'TPA',
  'Pharma Company',
  'NGO',
  'Government Department',
  'Wellness Center',
  'Home Healthcare Provider',
  'Ambulance Service',
  'Other',
];

/** Open-ended lead sources. */
export const LEAD_SOURCES = [
  'Referral',
  'Website',
  'LinkedIn',
  'Exhibition',
  'Cold Call',
  'Direct Visit',
  'Doctor Reference',
  'Existing Client',
  'Social Media',
  'Email Campaign',
  'WhatsApp Campaign',
  'Google Ads',
  'Field Marketing',
  'Conference',
  'Medical Camp',
  'Vendor Reference',
  'Internal Staff Reference',
  'Other',
];

/** Open-ended billing types. */
export const BILLING_TYPES = [
  'Cash',
  'Credit',
  'Invoice-based',
  'Monthly Settlement',
  'Commission-based',
  'Revenue Share',
  'Rate Contract',
  'Package Contract',
];

/** Integration options a lead may require. */
export const INTEGRATION_OPTIONS = [
  'API',
  'LIMS',
  'HIS',
  'EMR',
  'WhatsApp Reports',
  'Email Reports',
  'Portal Login',
  'Barcode Integration',
  'Sample Pickup Integration',
];

/** Documents a lead may require. */
export const REQUIRED_DOC_OPTIONS = [
  'Proposal',
  'Quotation',
  'Rate Card',
  'Agreement',
  'NABL Certificate',
  'License Copy',
  'Sample Report Format',
  'Test Menu',
  'Company Profile',
];

/** Preferred contact channels. */
export const PREFERRED_CONTACTS = ['Phone', 'Email', 'WhatsApp', 'In-Person'];

/** Status-filter bucket keys → the granular statuses each bucket includes. */
export const STATUS_BUCKETS: Record<string, LeadStatus[]> = {
  all: [],
  'new-lead': [LeadStatus.NEW_LEAD],
  scheduled: [
    LeadStatus.SCHEDULED,
    LeadStatus.CONFIRMED,
    LeadStatus.STARTED,
    LeadStatus.REACHED,
  ],
  confirmed: [LeadStatus.CONFIRMED],
  'meeting-in-progress': [LeadStatus.MEETING_IN_PROGRESS],
  'meeting-completed': [LeadStatus.MEETING_COMPLETED],
  'proposal-shared': [LeadStatus.PROPOSAL_SHARED],
  'quotation-shared': [LeadStatus.QUOTATION_SHARED],
  negotiation: [LeadStatus.NEGOTIATION, LeadStatus.AGREEMENT_PENDING],
  converted: [LeadStatus.CONVERTED, LeadStatus.CLIENT_ONBOARDING],
  'active-client': [LeadStatus.ACTIVE_CLIENT],
  'followup-required': [LeadStatus.FOLLOW_UP_REQUIRED],
  lost: [LeadStatus.LOST, LeadStatus.NOT_INTERESTED],
  'on-hold': [
    LeadStatus.ON_HOLD,
    LeadStatus.CANCELLED,
    LeadStatus.NO_RESPONSE,
    LeadStatus.DUPLICATE_LEAD,
  ],
};

/** The bucket key names, for query validation. */
export const STATUS_BUCKET_KEYS = Object.keys(STATUS_BUCKETS);

/** The lifecycle state machine: current status → the next "Immediate Action". */
export const NEXT_ACTION: Partial<
  Record<LeadStatus, { label: string; to: LeadStatus }>
> = {
  [LeadStatus.NEW_LEAD]: {
    label: 'Schedule Meeting',
    to: LeadStatus.SCHEDULED,
  },
  [LeadStatus.SCHEDULED]: {
    label: 'Confirm Meeting',
    to: LeadStatus.CONFIRMED,
  },
  [LeadStatus.CONFIRMED]: { label: 'Start Trip', to: LeadStatus.STARTED },
  [LeadStatus.STARTED]: { label: 'Mark Reached', to: LeadStatus.REACHED },
  [LeadStatus.REACHED]: {
    label: 'Start Meeting',
    to: LeadStatus.MEETING_IN_PROGRESS,
  },
  [LeadStatus.MEETING_IN_PROGRESS]: {
    label: 'Complete Meeting',
    to: LeadStatus.MEETING_COMPLETED,
  },
  [LeadStatus.MEETING_COMPLETED]: {
    label: 'Update Outcome',
    to: LeadStatus.MEETING_COMPLETED,
  },
  [LeadStatus.PROPOSAL_SHARED]: {
    label: 'Share Quotation',
    to: LeadStatus.QUOTATION_SHARED,
  },
  [LeadStatus.QUOTATION_SHARED]: {
    label: 'Negotiation',
    to: LeadStatus.NEGOTIATION,
  },
  [LeadStatus.NEGOTIATION]: {
    label: 'Mark Converted',
    to: LeadStatus.CONVERTED,
  },
  [LeadStatus.CONVERTED]: {
    label: 'Start Onboarding',
    to: LeadStatus.CLIENT_ONBOARDING,
  },
  [LeadStatus.CLIENT_ONBOARDING]: {
    label: 'Activate Client',
    to: LeadStatus.ACTIVE_CLIENT,
  },
  [LeadStatus.FOLLOW_UP_REQUIRED]: {
    label: 'Schedule Follow-up',
    to: LeadStatus.SCHEDULED,
  },
};

/** Maps a recorded meeting outcome → the resulting lead status. */
export const OUTCOME_TO_STATUS: Record<MeetingOutcome, LeadStatus> = {
  [MeetingOutcome.FOLLOW_UP_REQUIRED]: LeadStatus.FOLLOW_UP_REQUIRED,
  [MeetingOutcome.PROPOSAL_REQUIRED]: LeadStatus.MEETING_COMPLETED,
  [MeetingOutcome.PROPOSAL_SHARED]: LeadStatus.PROPOSAL_SHARED,
  [MeetingOutcome.QUOTATION_REQUIRED]: LeadStatus.PROPOSAL_SHARED,
  [MeetingOutcome.QUOTATION_SHARED]: LeadStatus.QUOTATION_SHARED,
  [MeetingOutcome.NEGOTIATION]: LeadStatus.NEGOTIATION,
  [MeetingOutcome.CONVERTED]: LeadStatus.CONVERTED,
  [MeetingOutcome.NOT_INTERESTED]: LeadStatus.NOT_INTERESTED,
  [MeetingOutcome.LOST]: LeadStatus.LOST,
  [MeetingOutcome.RESCHEDULED]: LeadStatus.RESCHEDULED,
  [MeetingOutcome.PENDING_MANAGEMENT_APPROVAL]: LeadStatus.MEETING_COMPLETED,
  [MeetingOutcome.PENDING_TECHNICAL_DISCUSSION]: LeadStatus.MEETING_COMPLETED,
  [MeetingOutcome.PENDING_FINANCE_DISCUSSION]: LeadStatus.MEETING_COMPLETED,
  [MeetingOutcome.NEED_PRODUCT_DEMO]: LeadStatus.MEETING_COMPLETED,
  [MeetingOutcome.NEED_RATE_APPROVAL]: LeadStatus.MEETING_COMPLETED,
  [MeetingOutcome.NEED_AGREEMENT_REVIEW]: LeadStatus.MEETING_COMPLETED,
};
