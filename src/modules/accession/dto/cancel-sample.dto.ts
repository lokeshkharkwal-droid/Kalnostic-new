import { IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Cancel Sample modal payload (PDF §A.10 — New/Collected/Hold → Cancelled). A
 * cancellation `reason` is mandatory (recorded as the history reason).
 */
export class CancelSampleDto extends SampleNoteDto {
  /** Cancellation reason (mandatory). */
  @IsString()
  @MaxLength(255)
  reason: string;
}
