/**
 * Supported PDF report template `type` keys.
 *
 * The frontend exposes a "type" select and the Configuration screen maps a
 * default template per document slot. `type` is deliberately a plain string
 * column (not a Prisma enum) so this list can grow WITHOUT a database migration —
 * validation is done app-side against this constant (`@IsIn(...)` in the DTOs,
 * plus a defence-in-depth check in the service).
 *
 * The list mirrors the old kishan project's document-slot catalogue (General /
 * Lab / OPD-Clinic / Blood Bank), unioned with the original Kalnostics keys that
 * predate it (`invoice`, `prescription`, `appointment_slip`, `registration_slip`)
 * so existing templates keep resolving. Keys are kept verbatim to match kishan
 * (including its `accounts_biling` spelling). The grouped slot catalogue lives in
 * `pdf-template-config-slots.constant.ts`.
 */
export const PDF_REPORT_TEMPLATE_TYPES = [
  // ── General ──
  'patient_card',
  'patient_entry_token',
  'consent_form',
  'patient_entry_ticket',
  'referring_panel_patient_bill',
  'accounts_biling',
  // ── Lab ──
  'lab_report',
  'lab_panel',
  'lab_all_report',
  'lab_all_report_with_letterhead',
  'order_print',
  'order_print_without_bill',
  'bill_print',
  'referral_patient_bill_print',
  'lab_quotation_print',
  'order_label_print',
  'multiple_order_label_print',
  'radiology_report',
  'radiology_report_certificate',
  'patient_lab_all_report',
  // ── OPD / Clinic ──
  'visit_note_print_prescription',
  'visit_note_print_lab_orders',
  'visit_note_print_radiology_orders',
  'visit_note_print_blank_certificate',
  'visit_note_print_treatment_plan',
  'visit_note_print_summary',
  'visit_note_print_all_investigation',
  'patient_discharge',
  // ── Blood Bank ──
  'blood_donation_complete_label',
  'blood_request_cross_match',
  // ── Original Kalnostics keys (kept for existing templates) ──
  'invoice',
  'prescription',
  'appointment_slip',
  'registration_slip',
] as const;

/** Union of the supported template type keys. */
export type PdfReportTemplateType = (typeof PDF_REPORT_TEMPLATE_TYPES)[number];

/** Default `type` when the client omits it (spec default). */
export const DEFAULT_PDF_REPORT_TEMPLATE_TYPE: PdfReportTemplateType =
  'lab_report';

/** Human-readable labels for the type select (frontend options endpoint). */
export const PDF_REPORT_TEMPLATE_TYPE_LABELS: Record<
  PdfReportTemplateType,
  string
> = {
  // General
  patient_card: 'Patient Card',
  patient_entry_token: 'Patient Entry Token',
  consent_form: 'Patient Consent Form',
  patient_entry_ticket: 'Patient Entry Ticket',
  referring_panel_patient_bill: 'Referring Panel Patient Bill',
  accounts_biling: 'Accounts Billing',
  // Lab
  lab_report: 'Lab Test Report',
  lab_panel: 'Lab Panel Report',
  lab_all_report: 'Lab All Reports',
  lab_all_report_with_letterhead: 'Lab All Reports (Letterhead)',
  order_print: 'Lab Order',
  order_print_without_bill: 'Lab Order (Without Bill)',
  bill_print: 'Lab Order Bill',
  referral_patient_bill_print: 'Referral Patient Bill',
  lab_quotation_print: 'Lab Quotation',
  order_label_print: 'Lab Order Label',
  multiple_order_label_print: 'Lab Order Multiple Labels',
  radiology_report: 'Radiology Report',
  radiology_report_certificate: 'Radiology Certificate',
  patient_lab_all_report: 'Patient Lab All Reports',
  // OPD / Clinic
  visit_note_print_prescription: 'Visit Note — Prescription',
  visit_note_print_lab_orders: 'Visit Note — Lab Orders',
  visit_note_print_radiology_orders: 'Visit Note — Radiology Orders',
  visit_note_print_blank_certificate: 'Visit Note — Blank Certificate',
  visit_note_print_treatment_plan: 'Visit Note — Treatment Plan',
  visit_note_print_summary: 'Visit Note — Summary',
  visit_note_print_all_investigation: 'Visit Note — All Investigation',
  patient_discharge: 'Patient Discharge Slip',
  // Blood Bank
  blood_donation_complete_label: 'Blood Donation Label',
  blood_request_cross_match: 'Blood Request Cross Match',
  // Original Kalnostics keys
  invoice: 'Invoice / Receipt',
  prescription: 'Prescription',
  appointment_slip: 'Appointment Slip',
  registration_slip: 'Registration Slip',
};

/** Narrowing type guard for a candidate type string. */
export function isPdfReportTemplateType(
  value: string,
): value is PdfReportTemplateType {
  return (PDF_REPORT_TEMPLATE_TYPES as readonly string[]).includes(value);
}
