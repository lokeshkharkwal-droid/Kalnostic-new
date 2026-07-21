import { IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Accept Sample modal payload (PDF §A.10 — Collected/Halt → Accepted).
 * `sampleCondition` is mandatory (the modal's required condition dropdown, sourced
 * from `AccessionSetting`). Acceptance stamps `receivedAt`/`acceptedAt` server-side.
 */
export class AcceptSampleDto extends SampleNoteDto {
  /** Observed sample condition (mandatory). Validated against the branch's list. */
  @IsString()
  @MaxLength(100)
  sampleCondition: string;
}
