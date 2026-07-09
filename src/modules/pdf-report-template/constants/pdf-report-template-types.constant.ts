/**
 * Supported PDF report template `type` keys.
 *
 * The frontend exposes a "type" select (~49 keys per the spec), defaulting to
 * `lab_report`. `type` is deliberately a plain string column (not a Prisma
 * enum) so this list can grow WITHOUT a database migration — validation is done
 * app-side against this constant (`@IsIn(PDF_REPORT_TEMPLATE_TYPES)` in the
 * DTOs, plus a defence-in-depth check in the service).
 *
 * ⚠️ This is the single place to maintain the list. It is seeded with the keys
 * known from the reference implementation (kaltros-master); paste the full
 * ~49-key list here as the frontend contract is finalised — nothing else needs
 * to change.
 */
export const PDF_REPORT_TEMPLATE_TYPES = [
  'lab_report',
  'radiology_report',
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
  lab_report: 'Lab Report',
  radiology_report: 'Radiology Report',
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
