/** The name parts a patient row carries. */
export interface PatientNameParts {
  salutation?: string | null;
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
}

/**
 * Compose a display name from a patient's name parts, skipping blanks.
 * @param patient the patient's name parts
 * @param includeSalutation whether to put the salutation (Mr/Ms/...) first
 * @returns e.g. "Sahu Kumar"
 */
export function composePatientName(
  patient: PatientNameParts,
  includeSalutation = false,
): string {
  return [
    includeSalutation ? patient.salutation : null,
    patient.firstName,
    patient.middleName,
    patient.lastName,
  ]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(' ');
}
