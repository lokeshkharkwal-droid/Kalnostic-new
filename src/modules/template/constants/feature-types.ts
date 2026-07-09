/**
 * Messaging template feature keys — the business event each template handles.
 * Ported from the reference FE (kaltros-master messaging feature-types), grouped
 * by domain for the form select dropdown and list display.
 *
 * The `feature` column is a plain String (CLAUDE.md decision) validated app-side
 * against {@link FEATURE_TYPE_VALUES}, so new features can be added here without
 * a database migration.
 */

/** One selectable feature option. */
export interface FeatureOption {
  value: string;
  label: string;
}

/** A labelled group of feature options (for grouped FE dropdowns). */
export interface FeatureGroup {
  label: string;
  options: FeatureOption[];
}

/** Feature options grouped by domain (served by `GET /templates/features`). */
export const MESSAGING_FEATURES_GROUPED: FeatureGroup[] = [
  {
    label: 'Platform & Business',
    options: [
      { value: 'assistant_create', label: 'Assistant Created' },
      { value: 'business_registration', label: 'Business Registration' },
      {
        value: 'business_registration_complete',
        label: 'Business Registration Complete',
      },
      { value: 'business_details_update', label: 'Business Details Updated' },
      {
        value: 'business_status_suspend',
        label: 'Business Status — Suspended',
      },
      {
        value: 'business_status_unsuspend',
        label: 'Business Status — Unsuspended',
      },
      { value: 'business_license_create', label: 'Business License Created' },
      { value: 'business_license_update', label: 'Business License Updated' },
      { value: 'business_approve', label: 'Business Approved' },
      { value: 'business_reject', label: 'Business Rejected' },
      { value: 'book_demo', label: 'Book Demo' },
      { value: 'contact_sales', label: 'Contact Sales' },
    ],
  },
  {
    label: 'Contact & Support',
    options: [
      {
        value: 'contact_us_request_with_attachment',
        label: 'Contact Us — Request with Attachment',
      },
      {
        value: 'contact_us_request_inform_client',
        label: 'Contact Us — Inform Client',
      },
      {
        value: 'report_download_request_completed',
        label: 'Report Download Request Completed',
      },
    ],
  },
  {
    label: 'Doctor Appointments',
    options: [
      {
        value: 'doctor_accept_appointment',
        label: 'Doctor Accept Appointment',
      },
      {
        value: 'doctor_reject_appointment',
        label: 'Doctor Reject Appointment',
      },
      { value: 'doctor_move_appointment', label: 'Doctor Move Appointment' },
      {
        value: 'doctor_followup_appointment',
        label: 'Doctor Followup Appointment',
      },
      {
        value: 'appointment_reminder_inform_patient',
        label: 'Appointment Reminder — Inform Patient',
      },
      {
        value: 'appointment_reminder_inform_doctor',
        label: 'Appointment Reminder — Inform Doctor',
      },
      {
        value: 'appointment_followup_reminder_inform_patient',
        label: 'Appointment Followup Reminder — Inform Patient',
      },
      {
        value: 'doctor_refer_patient_inform_doctor',
        label: 'Doctor Refer Patient — Inform Doctor',
      },
      {
        value: 'doctor_refer_patient_inform_patient',
        label: 'Doctor Refer Patient — Inform Patient',
      },
      { value: 'doctor_submit_note', label: 'Doctor Submit Note' },
      {
        value: 'doctor_create_appointment_inform_patient',
        label: 'Doctor Create Appointment — Inform Patient',
      },
      {
        value: 'doctor_confirmed_appointment_template',
        label: 'Doctor Confirmed Appointment',
      },
      {
        value: 'doctor_history_appointment_template',
        label: 'Doctor History Appointment',
      },
      {
        value: 'doctor_new_appointment_template',
        label: 'Doctor New Appointment',
      },
    ],
  },
  {
    label: 'Lab Appointments',
    options: [
      { value: 'lab_accept_appointment', label: 'Lab Accept Appointment' },
      {
        value: 'lab_move_appointment',
        label: 'Lab Move Appointment — Inform Patient',
      },
      {
        value: 'lab_create_appointment_inform_patient',
        label: 'Lab Create Appointment — Inform Patient',
      },
      {
        value: 'lab_create_appointment_with_same_technician',
        label: 'Lab Appointment — Same Technician',
      },
      {
        value: 'lab_create_appointment_with_different_technician',
        label: 'Lab Appointment — Different Technician',
      },
    ],
  },
  {
    label: 'Lab Orders & Reports',
    options: [
      {
        value: 'doctor_create_lab_order_inform_patient',
        label: 'Doctor Create Lab Order — Inform Patient',
      },
      {
        value: 'doctor_create_lab_order_inform_lab',
        label: 'Doctor Create Lab Order — Inform Lab',
      },
      {
        value: 'lab_create_order_inform_patient',
        label: 'Lab Create Order — Inform Patient',
      },
      {
        value: 'lab_create_order_with_phlebotomist_inform_patient',
        label: 'Lab Create Order (Phlebotomist) — Inform Patient',
      },
      {
        value:
          'lab_create_order_with_phlebotomist_inform_patient_as_attachment',
        label: 'Lab Create Order (Phlebotomist) — Inform Patient as Attachment',
      },
      {
        value: 'lab_order_completed_inform_patient',
        label: 'Lab Order Completed — Inform Patient',
      },
      {
        value: 'lab_order_report_published_inform_patient',
        label: 'Lab Order Report Published — Inform Patient',
      },
      {
        value: 'lab_order_report_refund_inform_patient',
        label: 'Lab Order Report Refund — Inform Patient',
      },
      {
        value: 'lab_order_report_error_inform_patient',
        label: 'Lab Order Report Error — Inform Patient',
      },
      {
        value: 'lab_report_filled_inform_patient',
        label: 'Lab Report Filled — Inform Patient',
      },
      {
        value: 'lab_report_sample_error_inform_referring_panel',
        label: 'Lab Report Sample Error — Inform Referring Panel',
      },
      {
        value: 'lab_report_sample_repeat_inform_referring_panel',
        label: 'Lab Report Sample Repeat — Inform Referring Panel',
      },
      {
        value: 'lab_accept_order_inform_doctor',
        label: 'Lab Accept Direct Order — Inform Doctor',
      },
      {
        value: 'lab_reject_order_inform_doctor',
        label: 'Lab Reject Direct Order — Inform Doctor',
      },
      {
        value: 'lab_publish_direct_order_inform_doctor',
        label: 'Lab Publish Direct Order — Inform Doctor',
      },
    ],
  },
  {
    label: 'Attachments & Downloads',
    options: [
      { value: 'order_bill_as_attachment', label: 'Order Bill as Attachment' },
      {
        value: 'order_invoice_as_attachment',
        label: 'Order Invoice as Attachment',
      },
      { value: 'lab_report_as_attachment', label: 'Lab Report as Attachment' },
      {
        value: 'smart_lab_report_as_attachment',
        label: 'Smart Lab Report as Attachment',
      },
      {
        value: 'email_lab_report_as_attachment',
        label: 'Email — Lab Report as Attachment',
      },
      {
        value: 'email_lab_report_as_attachment_auto_email',
        label: 'Email — Lab Report as Attachment (Auto)',
      },
      {
        value: 'whatsapp_lab_report_as_attachment',
        label: 'WhatsApp — Lab Report as Attachment',
      },
      {
        value: 'whatsapp_lab_report_as_attachment_auto_alert',
        label: 'WhatsApp — Lab Report as Attachment (Auto Alert)',
      },
      {
        value: 'email_visit_notes_as_attachment',
        label: 'Email — Visit Notes as Attachment',
      },
      {
        value: 'whatsapp_visit_notes_as_attachment',
        label: 'WhatsApp — Visit Notes as Attachment',
      },
      {
        value: 'email_visit_notes_medical_certificate_as_attachment',
        label: 'Email — Medical Certificate',
      },
      {
        value: 'email_visit_notes_echocardiography_certificate_as_attachment',
        label: 'Email — Echocardiography Certificate',
      },
      {
        value: 'email_visit_notes_ultrasound_certificate_as_attachment',
        label: 'Email — Ultrasound Certificate',
      },
      {
        value: 'email_visit_notes_ekg_ecg_certificate_as_attachment',
        label: 'Email — EKG/ECG Certificate',
      },
      {
        value: 'lab_quotation_as_attachment',
        label: 'Lab Quotation as Attachment',
      },
    ],
  },
  {
    label: 'Billing & Payments',
    options: [
      {
        value: 'complete_payment_for_lab_order_inform_patient',
        label: 'Complete Payment for Order — Inform Patient',
      },
      {
        value: 'partial_payment_for_lab_order_inform_patient',
        label: 'Partial Payment for Order — Inform Patient',
      },
      {
        value: 'patient_pay_request_for_order',
        label: 'Patient Pay Request for Order',
      },
    ],
  },
  {
    label: 'Patient',
    options: [
      { value: 'patient_registration', label: 'Patient Registration' },
      {
        value: 'patient_registration_complete',
        label: 'Patient Registration Complete',
      },
      {
        value: 'patient_create_appointment_inform_patient',
        label: 'Patient Create Appointment — Inform Patient',
      },
      {
        value: 'patient_create_appointment_inform_doctor',
        label: 'Patient Create Appointment — Inform Doctor',
      },
      {
        value: 'patient_create_appointment_inform_lab',
        label: 'Patient Create Appointment — Inform Lab',
      },
      { value: 'patient_activation_template', label: 'Patient Activation' },
      {
        value: 'patient_password_recovery',
        label: 'Patient Password Recovery',
      },
      { value: 'patient_profile_update', label: 'Patient Profile Update' },
    ],
  },
  {
    label: 'User Account & Auth',
    options: [
      { value: 'request_otp_for_login', label: 'Request OTP for Login' },
      { value: 'user_activation_template', label: 'User Activation' },
      { value: 'forgot_password', label: 'Forgot Password' },
    ],
  },
  {
    label: 'Marketing',
    options: [
      { value: 'bulk_messaging', label: 'Bulk Messaging' },
      { value: 'google_review_template', label: 'Google Review Request' },
    ],
  },
];

/** Flat list of every valid `feature` value — used by DTO `@IsIn` validation. */
export const FEATURE_TYPE_VALUES: readonly string[] =
  MESSAGING_FEATURES_GROUPED.flatMap((g) => g.options.map((o) => o.value));

/** Flat label lookup keyed by feature value (for list-view display). */
export const MESSAGING_FEATURE_LABELS: Record<string, string> =
  Object.fromEntries(
    MESSAGING_FEATURES_GROUPED.flatMap((g) =>
      g.options.map((o) => [o.value, o.label]),
    ),
  );
