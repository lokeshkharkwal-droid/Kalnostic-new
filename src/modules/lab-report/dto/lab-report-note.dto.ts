import { IsIn, IsOptional, IsString } from 'class-validator';

/** The 3 plain note tabs under the Test Entry header (LABORATORY.docx §4.2) —
 * "Documents" is the attachments feature (a separate, not-yet-built piece),
 * not a note category, so it's excluded here. The other 9 `LabReportNoteCategory`
 * values are written only as side-effects of their own specific actions
 * (Lock, Re-Run, Schedule, etc.), never through this plain add-a-note path. */
export const PLAIN_NOTE_CATEGORIES = ['ORDER', 'SAMPLE', 'TECH'] as const;
export type PlainNoteCategory = (typeof PLAIN_NOTE_CATEGORIES)[number];

/** Body for `POST /lab-reports/:id/notes`. */
export class CreateLabReportNoteDto {
  @IsIn(PLAIN_NOTE_CATEGORIES)
  category: PlainNoteCategory;

  @IsString()
  body: string;
}

/** Query for `GET /lab-reports/:id/notes` — omit `category` to return all 3
 * tabs' notes together (grouped by category in the response). */
export class ListLabReportNotesDto {
  @IsOptional()
  @IsIn(PLAIN_NOTE_CATEGORIES)
  category?: PlainNoteCategory;
}
