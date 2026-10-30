/**
 * A result parameter's Note (`LabTestResultParam.notes`) as it is written to the database.
 *
 * The Master Data editor sends `notes: ""` when the Note was cleared (an omitted `notes` means "leave it as it is", so
 * a cleared Note has to be sent explicitly). A blank Note — empty or only whitespace — is stored as NULL, the same
 * as "never had one", so the column holds either real text or NULL and every reader sees one "no note" value.
 * Real text is stored exactly as sent, and an omitted `notes` stays omitted (the stored Note is not touched).
 *
 * @param scalars the parameter's scalar fields as sent by the client
 * @returns the same fields with a blank `notes` turned into `null`
 */
export function blankNotesToNull<T extends { notes?: string | null }>(
  scalars: T,
): T {
  if (typeof scalars.notes !== 'string' || scalars.notes.trim() !== '') {
    return scalars;
  }
  return { ...scalars, notes: null };
}
