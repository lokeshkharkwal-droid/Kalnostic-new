import { Gender } from '@prisma/client';

/**
 * Human-readable label for a patient's `Gender`, for display in print
 * templates (`{patient_gender}`) and anywhere else raw enum casing shouldn't
 * leak to the user. `undefined`/`null` (never set) renders as `'—'` —
 * distinct from a patient who explicitly chose `OTHER`/`PREFER_NOT_TO_SAY` —
 * mirroring the frontend's `mapGender()` (`Billings/utils/mapBill.ts`).
 */
export function genderLabel(gender: Gender | null | undefined): string {
  switch (gender) {
    case Gender.MALE:
      return 'Male';
    case Gender.FEMALE:
      return 'Female';
    case Gender.OTHER:
      return 'Other';
    case Gender.PREFER_NOT_TO_SAY:
      return 'Prefer Not to Say';
    default:
      return '—';
  }
}
