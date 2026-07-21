import { IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Reject Sample modal (PDF §B.11.5) — Received → Rejected. `rejectionReason` is the
 * mandatory reason dropdown (configurable in Settings). The origin branch is
 * notified; the sample is not processed.
 */
export class TransferRejectDto extends SampleNoteDto {
  /** Reason for the rejection (mandatory). */
  @IsString()
  @MaxLength(255)
  rejectionReason: string;
}
