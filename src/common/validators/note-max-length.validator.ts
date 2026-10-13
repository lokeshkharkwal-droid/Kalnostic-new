import { MaxLength, ValidationArguments } from 'class-validator';

/**
 * Longest rich-text note, in characters of the stored HTML, accepted for any
 * "notes" field: a lab test's Useful For / Interpretation / Limitations /
 * Remarks / References, the Overall Result (template or report) and their
 * Technician per-report overrides.
 *
 * Why this number: the legacy system had no per-field limit (its column held
 * ~16 MB per report), so customers paste long text and must never hit a cap
 * in practice; 1,000,000 characters is roughly 500 pages of text. The cap
 * exists only so one bad request cannot write megabytes into a single field.
 * It sits well under the request size limit (`REQUEST_BODY_LIMIT_MB`). The
 * database columns are `text` (no limit), so changing this needs no migration.
 *
 * MIRRORED on the frontend as `NOTE_MAX_LENGTH` in `src/utils/text-limits.ts`.
 * Change both together (each side has a test that pins the number).
 */
export const NOTE_MAX_LENGTH = 1_000_000;

/**
 * Validation message for a note that is over the limit, naming the field and
 * both numbers so the user knows how much to cut.
 *
 * @param label the field's name as the user sees it, e.g. "Useful For"
 * @param actual how many characters were sent
 */
export function noteTooLongMessage(label: string, actual: number): string {
  return `${label} is too long (${actual.toLocaleString('en-US')} characters). The maximum is ${NOTE_MAX_LENGTH.toLocaleString('en-US')} characters.`;
}

/**
 * Decorator: the property may be at most `NOTE_MAX_LENGTH` characters, with a
 * clear message on failure. Use on every field that carries a rich-text note
 * so the Master Data side and the Technician side enforce the SAME rule.
 *
 * @param label the field's name as the user sees it, e.g. "Useful For"
 */
export function NoteMaxLength(label: string): PropertyDecorator {
  return MaxLength(NOTE_MAX_LENGTH, {
    message: (args: ValidationArguments) =>
      noteTooLongMessage(label, String(args.value ?? '').length),
  });
}
