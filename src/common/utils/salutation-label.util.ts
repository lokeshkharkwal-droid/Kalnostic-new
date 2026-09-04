import { Salutation } from '@prisma/client';

/**
 * Human-readable label for a patient's `Salutation`, for display in print
 * templates (`{patient_salutation}`) and anywhere else raw enum casing
 * shouldn't leak to the user — mirrors {@link genderLabel}'s convention.
 * `undefined`/`null` (never set) renders as `''` (patients aren't required
 * to have a salutation, unlike gender's `'—'` placeholder).
 */
export function salutationLabel(
  salutation: Salutation | null | undefined,
): string {
  switch (salutation) {
    case Salutation.DR:
      return 'Dr.';
    case Salutation.MR:
      return 'Mr.';
    case Salutation.MRS:
      return 'Mrs.';
    case Salutation.MS:
      return 'Ms.';
    case Salutation.PROF:
      return 'Prof.';
    default:
      return '';
  }
}
