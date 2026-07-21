import { IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Repeat Sample modal (PDF §B.11.4) — Received/Accepted → Repeat. `repeatReason`
 * is the mandatory reason dropdown (configurable in Settings). The origin branch is
 * notified to re-collect.
 */
export class TransferRepeatDto extends SampleNoteDto {
  /** Reason for the repeat (mandatory). */
  @IsString()
  @MaxLength(255)
  repeatReason: string;
}
