import { IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Repeat Sample modal payload (PDF §A.10 — Acquired/Halt/Error → Repeat). A
 * `repeatReason` is mandatory (recorded as the history reason; validated against
 * the branch's configured repeat reasons).
 */
export class RepeatSampleDto extends SampleNoteDto {
  /** Reason the sample is flagged for re-collection (mandatory). */
  @IsString()
  @MaxLength(255)
  repeatReason: string;
}
