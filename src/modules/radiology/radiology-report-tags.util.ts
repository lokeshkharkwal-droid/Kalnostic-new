/**
 * Shared, pure tag builders for the radiology report print paths — reused by
 * `RadiologyPrintService` (single `radiology_report`) and
 * `RadiologyAllReportService` (`radiology_all_report` Latte context) so the
 * reporting-doctor / patient tag shapes never drift between them.
 *
 * Kept in lockstep with the frontend tag catalogue
 * (`kaltros-fe/src/lib/print-templates/print-template-variables.ts` —
 * `RADIOLOGY_REPORT_VARIABLES` + `RADIOLOGY_ALL_REPORT_SNIPPETS`).
 */

/** The reporting-doctor columns the tag builders read (a slice of
 *  `RadiologyReportingDoctor`). */
export interface ReportingDoctorTagSource {
  doctorType: string;
  salutation: string | null;
  firstName: string;
  lastName: string;
  gender: string | null;
  registrationNo: string;
  signatoryDesignation: string | null;
  signatureImagePath: string | null;
}

/** The patient columns the tag builders read (a slice of `Patient`). */
export interface PatientTagSource {
  salutation: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  gender: string | null;
  bloodGroup: string | null;
  dateOfBirth: Date | null;
  age: number | null;
  mobile: string | null;
  addressLine1: string | null;
  umId: string | null;
}

/** `salutation + first + last`, blanks skipped. */
export function reportingDoctorFullName(
  d: Pick<
    ReportingDoctorTagSource,
    'salutation' | 'firstName' | 'lastName'
  > | null,
): string {
  if (!d) return '';
  return [d.salutation, d.firstName, d.lastName]
    .filter((p): p is string => Boolean(p))
    .join(' ');
}

/** YYYY-MM-DD, or '' for a null/absent date (matches the existing radiology
 *  print date formatting). */
export function isoDate(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString().slice(0, 10) : '';
}

/** Whole-year age from a DOB, floored at 0; '' when no DOB. */
export function ageFromDob(dob: Date | null | undefined): string {
  if (!dob) return '';
  return String(
    Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000),
      ),
    ),
  );
}

/**
 * Flat `{reporting_doctor_*}` tags for a `radiology_report` template. Every key
 * is always present (empty string when no doctor / no value) so a template tag
 * never renders as a literal `{tag}`. `reporting_doctor_signature` is the
 * uploaded signature image URL (`signatureImagePath`) — usable as
 * `<img src="{reporting_doctor_signature}">` or
 * `{{image:reporting_doctor_signature}}`.
 */
export function reportingDoctorVariables(
  d: ReportingDoctorTagSource | null,
): Record<string, string> {
  return {
    reporting_doctor_type: d?.doctorType ?? '',
    reporting_doctor_salutation: d?.salutation ?? '',
    reporting_doctor_gender: d?.gender ?? '',
    reporting_doctor_first_name: d?.firstName ?? '',
    reporting_doctor_last_name: d?.lastName ?? '',
    reporting_doctor_full_name: reportingDoctorFullName(d),
    reporting_doctor_registration_no: d?.registrationNo ?? '',
    reporting_doctor_designation: d?.signatoryDesignation ?? '',
    reporting_doctor_signature: d?.signatureImagePath ?? '',
  };
}

/**
 * Nested reporting-doctor object for the Latte per-study context
 * (`{$report->reporting_doctor->full_name}` etc.). Mirrors the flat tag set
 * above but shaped for Latte's `->` member access.
 */
export function reportingDoctorObject(
  d: ReportingDoctorTagSource | null,
): Record<string, string> {
  return {
    type: d?.doctorType ?? '',
    salutation: d?.salutation ?? '',
    gender: d?.gender ?? '',
    first_name: d?.firstName ?? '',
    last_name: d?.lastName ?? '',
    full_name: reportingDoctorFullName(d),
    registration_no: d?.registrationNo ?? '',
    designation: d?.signatoryDesignation ?? '',
    signature: d?.signatureImagePath ?? '',
  };
}

/** `salutation + first + middle + last`, blanks skipped. */
export function patientFullName(p: PatientTagSource | null): string {
  if (!p) return '';
  return [p.salutation, p.firstName, p.middleName, p.lastName]
    .filter((v): v is string => Boolean(v))
    .join(' ');
}

/** Single-unit age display: the stored whole-year age, else derived from DOB. */
export function patientAge(p: PatientTagSource | null): string {
  if (!p) return '';
  return p.age != null ? String(p.age) : ageFromDob(p.dateOfBirth);
}

/**
 * Flat `{patient_*}` tags for a `radiology_report` template — the same patient
 * keys the lab report exposes (name/salutation/age/gender/um_id/mobile/address/
 * dob/blood group).
 */
export function patientVariables(
  p: PatientTagSource | null,
): Record<string, string> {
  return {
    patient_name: patientFullName(p),
    patient_salutation: p?.salutation ?? '',
    patient_age: patientAge(p),
    patient_gender: p?.gender ?? '',
    patient_um_id: p?.umId ?? '',
    patient_mobile: p?.mobile ?? '',
    patient_address1: p?.addressLine1 ?? '',
    patient_dob: isoDate(p?.dateOfBirth),
    patient_blood_group: p?.bloodGroup ?? '',
  };
}

/**
 * The HTML fallback for a study's report body when NO certificate has been
 * issued — a simple Findings / Impression / Recommendation block built from the
 * study's narrative fields. The issued certificate's `content` is the preferred
 * source; this only fills in when none exists. Returns '' when the study has no
 * narrative at all.
 */
export function narrativeBodyHtml(study: {
  findings: string | null;
  impression: string | null;
  recommendation: string | null;
}): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const section = (label: string, value: string | null): string =>
    value && value.trim()
      ? `<p><strong>${label}:</strong><br/>${esc(value).replace(/\n/g, '<br/>')}</p>`
      : '';
  const html = [
    section('Findings', study.findings),
    section('Impression', study.impression),
    section('Recommendation', study.recommendation),
  ]
    .filter(Boolean)
    .join('\n');
  return html;
}
