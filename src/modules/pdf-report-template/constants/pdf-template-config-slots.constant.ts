import { PdfReportTemplateType } from './pdf-report-template-types.constant';

/**
 * The "Configuration" screen lets a tenant pick a DEFAULT template per document
 * slot. Each slot maps 1:1 to a `PDF_REPORT_TEMPLATE_TYPES` key, so the frontend
 * filters the template dropdown by `type = slotKey`. Groups + labels mirror the
 * old kishan project's config screen verbatim (General / Lab / OPD-Clinic /
 * Blood Bank). Slots are grouped only for display; the flat key list is the
 * source of truth for validation.
 */
export interface PdfTemplateConfigSlot {
  /** A `PDF_REPORT_TEMPLATE_TYPES` key. */
  key: PdfReportTemplateType;
  /** Human-readable slot label for the UI (kishan wording). */
  label: string;
}

export interface PdfTemplateConfigSlotGroup {
  label: string;
  slots: PdfTemplateConfigSlot[];
}

/** Grouped slot catalogue returned by `GET /pdf-report-templates/config/slots`. */
export const PDF_TEMPLATE_CONFIG_SLOT_GROUPS: PdfTemplateConfigSlotGroup[] = [
  {
    label: 'General',
    slots: [
      { key: 'patient_card', label: 'Patient Card' },
      { key: 'patient_entry_token', label: 'Patient Entry Token' },
      { key: 'consent_form', label: 'Patient Consent Form' },
      { key: 'patient_entry_ticket', label: 'Patient Entry Ticket' },
      {
        key: 'referring_panel_patient_bill',
        label: 'Referring Panel Patient Bill PDF Template',
      },
      { key: 'accounts_biling', label: 'Accounts Billing Bill PDF Template' },
    ],
  },
  {
    label: 'Lab',
    slots: [
      { key: 'lab_report', label: 'Lab Test Report' },
      { key: 'lab_panel', label: 'Lab Panel Report' },
      { key: 'lab_all_report', label: 'Lab All Reports' },
      {
        key: 'lab_all_report_with_letterhead',
        label: 'Lab All Reports With Letterhead Images',
      },
      { key: 'order_print', label: 'Lab Order PDF Template' },
      {
        key: 'order_print_without_bill',
        label: 'Lab Order Without Bill PDF Template',
      },
      { key: 'bill_print', label: 'Lab Order Bill PDF Template' },
      {
        key: 'referral_patient_bill_print',
        label: 'Lab Order Referral Patient Bill PDF Template',
      },
      { key: 'lab_quotation_print', label: 'Lab Quotation PDF Template' },
      { key: 'order_label_print', label: 'Lab Order Label Print Template' },
      {
        key: 'multiple_order_label_print',
        label: 'Lab Order Multiple Label Print Template',
      },
      { key: 'radiology_report', label: 'Radiology Report' },
      {
        key: 'radiology_report_certificate',
        label: 'Radiology Certificate Print Template',
      },
      { key: 'patient_lab_all_report', label: 'Patient Lab All Reports' },
    ],
  },
  {
    label: 'OPD / Clinic',
    slots: [
      {
        key: 'visit_note_print_prescription',
        label: 'Visit Note Print Prescription Template',
      },
      {
        key: 'visit_note_print_lab_orders',
        label: 'Visit Note Print Lab Orders Template',
      },
      {
        key: 'visit_note_print_radiology_orders',
        label: 'Visit Note Print Radiology Orders Template',
      },
      {
        key: 'visit_note_print_blank_certificate',
        label: 'Visit Note Print Blank Certificate Template',
      },
      {
        key: 'visit_note_print_treatment_plan',
        label: 'Visit Note Print Treatment Plan Template',
      },
      { key: 'visit_note_print_summary', label: 'Visit Note Print Summary' },
      {
        key: 'visit_note_print_all_investigation',
        label: 'Visit Note Print All Investigation Template',
      },
      { key: 'patient_discharge', label: 'Patient Discharge Slip' },
    ],
  },
  {
    label: 'Blood Bank',
    slots: [
      { key: 'blood_donation_complete_label', label: 'Blood Donation Label' },
      {
        key: 'blood_request_cross_match',
        label: 'Blood Request Cross Match Report',
      },
    ],
  },
];

/** Flat set of valid slot keys (defence-in-depth validation in the service). */
export const PDF_TEMPLATE_CONFIG_SLOT_KEYS: readonly string[] =
  PDF_TEMPLATE_CONFIG_SLOT_GROUPS.flatMap((g) => g.slots.map((s) => s.key));
