import { IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Discard Sample modal payload (PDF §A.10 — Stored → Discarded). `discardMethod`
 * is mandatory (recorded as the history reason; validated against the branch's
 * configured discard methods).
 */
export class DiscardSampleDto extends SampleNoteDto {
  /** Discard method (mandatory), e.g. "Biohazard Bag". */
  @IsString()
  @MaxLength(100)
  discardMethod: string;
}
