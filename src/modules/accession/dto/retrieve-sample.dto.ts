import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Retrieve Sample modal payload (§A.7 / §A.10.19 — the universal undo). Restores
 * the sample to its recorded `previousStatus` (reverting a transfer to Accepted).
 * Optionally records the station/lab the sample was retrieved from — stored on the
 * retrieve history row's `reason` (same channel `share` uses for its metadata) —
 * plus the shared Notes + Attachment URL (inherited from {@link SampleNoteDto}).
 */
export class RetrieveSampleDto extends SampleNoteDto {
  /** Station / lab the sample is being retrieved from. */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  retrievedFrom?: string;
}
